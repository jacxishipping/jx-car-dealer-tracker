# Deployment — JX Car Dealer Tracker

The app has two parts: this frontend (Vite + React) and the production API
server in `server/` (Node/TS + PostgreSQL). The frontend runs in one of two
modes — see [Modes](#modes) — and the server is a separate deployable.

## Modes

| Mode | How it is selected | Data | Auth |
|---|---|---|---|
| **Demo** (default) | `VITE_API_URL` is **unset** | localStorage key `jx-dealer-tracker-v1`, seeded demo data | None — the role switcher is a demo control |
| **API** | `VITE_API_URL` is set to the server URL | PostgreSQL, via the API (`GET /api/state` is the snapshot) | JWT login screen (`/api/auth/login`, `/api/auth/register`); tokens in localStorage keys `jx-dealer-token` / `jx-dealer-refresh` |

Demo mode is unchanged by the API wiring: with `VITE_API_URL` unset the app
builds and behaves exactly as before, and no login screen ever appears.

## Environment variables (names only — never commit values)

Copy `.env.example` to `.env` (server) / `.env.local` (frontend) and fill in
real values at runtime. `.env`, `.env.local` and `.env.*` are git-ignored;
only `.env.example` (placeholders) is tracked.

| Variable | Used by | Notes |
|---|---|---|
| `VITE_API_URL` | Frontend | Base URL of the API server, e.g. `http://localhost:3001` locally or the deployed server URL in production. Unset = demo mode. |
| `DATABASE_URL` | Server | PostgreSQL connection string (Neon — see below). |
| `JWT_SECRET` | Server | Long random secret for signing access tokens. |
| `CORS_ORIGIN` | Server | Frontend origin allowed to call the API, e.g. `http://localhost:5173` locally or the Vercel URL in production. |
| `PORT` | Server | Port the API listens on (`3001` locally). |

## Run locally

Terminal 1 — server:

```bash
cd server
npm install
npm run migrate     # applies docs/schema.sql to DATABASE_URL
npm run seed-admin  # creates the first owner account (credentials supplied
                    # at runtime only — never written into a file)
npm run dev         # API on http://localhost:3001
```

Terminal 2 — frontend:

```bash
npm install
VITE_API_URL=http://localhost:3001 npm run dev   # Vite on http://localhost:5173
```

Open the frontend, register an organization (or sign in with the seeded
admin), and the store loads from `GET /api/state`. To go back to demo mode,
stop the frontend and run `npm run dev` without `VITE_API_URL`.

## Neon (PostgreSQL) notes

- Use the **pooled** `DATABASE_URL` from the Neon dashboard (the
  `...-pooler.` host). The pooler handles the server's connections; the
  direct (unpooled) URL is only a fallback if the pooler fails.
- `sslmode=require` is already in the example connection string — keep it.
- Run migrations (`npm run migrate`) against the same `DATABASE_URL` the
  server uses, so the schema and the data never drift apart.

## Deploy the frontend (Vercel)

1. Import the repository into Vercel (framework preset: Vite — see
   `vercel.json` at the project root: `npm run build`, output `dist`, SPA
   rewrite of every path to `/index.html`).
2. Set the environment variable `VITE_API_URL` to the deployed server URL
   (e.g. `https://api.example.com`). No other variable is needed for the
   frontend build.
3. Deploy. With `VITE_API_URL` set, the deployed app shows the login screen
   and talks to the API; without it, it would silently fall back to demo
   mode — so verify the variable is set before sharing the link.

## Deploy the server (Render / Railway / VPS)

The server is a plain Node service (`npm install`, `npm run build` if it has
a build step, then `node`/`npm start` — follow `server/README.md` for its
exact start command).

- **Render:** New Web Service → point it at `server/` (or the repo root
  with the root directory set to `server/`) → set `DATABASE_URL`,
  `JWT_SECRET`, `CORS_ORIGIN` (the Vercel frontend
  URL) and `PORT` in Environment. Run `npm run migrate` once (Render Shell
  or a one-off job) before the first deploy goes live.
- **Railway:** New Project → deploy from GitHub, service root `server/` →
  add the same variables; add a Neon `DATABASE_URL` (or Railway Postgres)
  and run `npm run migrate` once via the Railway CLI / one-off command.
- **VPS (e.g. a droplet):** clone the repo, `cd server && npm install`,
  create `.env` with the variables above, run `npm run migrate`, then run
  the server under `systemd` (or `pm2`) behind `nginx`/`Caddy` with TLS so
  the frontend's `VITE_API_URL` is an `https://` origin. Restart the
  service after any `.env` change.

After any server deploy, point the Vercel `VITE_API_URL` at the new server
URL and redeploy the frontend (a Vite env change needs a rebuild).

## Health check

```bash
curl https://<server-host>/health
```

Expect HTTP 200 with a JSON status payload. If it fails, check the server
logs, then `DATABASE_URL` (Neon pooler reachable, `sslmode=require`), then
that `PORT` matches what the host is routing to.

## Backups

The database lives on Neon: use **Neon point-in-time restore** (PITR) from
the Neon dashboard to recover to any point in the retention window. There is
no separate backup job in this repo. Before a risky migration, take a Neon
branch (instant copy-on-write snapshot) and migrate the branch first.

## What is still NOT included

- **Object storage** — documents and vehicle photos are metadata only
  (file names / sizes recorded, no file bytes stored or served). Add an
  S3-compatible bucket and a `storage_key` upload flow before accepting
  real files.
- **Voice / OCR backend** — the AI Assistant's Voice button is visual-only
  and the photo picker records only the file name. There is no speech or
  OCR service wired to the API.
- **Live MCP server** — the API now exposes the tools as authenticated
  REST endpoints under `/api/mcp` (19 tools, confirmation required for
  sensitive writes); there is no standalone MCP-protocol (SSE/streaming)
  server yet.
- **Email / notifications delivery and payment processing** — not part of
  this deployment.

## Live verification (2026-11-10, Neon)

- Migration run twice against the Neon database (idempotent): **40 tables
  verified in schema `dealer`** (39 from `docs/schema.sql` + `dealer.offers`
  from `server/src/lib/schema-extras.ts`). One DDL fix was needed on the
  first run: `dealer.vehicle_documents` referenced `dealer.documents`
  before it existed; the FK is now added by a guarded `DO` block after
  the `documents` table. Seeded reference data only: 14 permissions,
  18 expense categories. The 2 pre-existing `public` tables were untouched.
- Server tests: **27/27 pass** (16 unit + 11 integration against the live
  database), including register/login, Viewer 403 on sale finalisation,
  duplicate VIN → 409, FIFO allocate 12 = $620 (10@$50 + 2@$60), atomic
  sale finalisation, and MCP confirmation gating. Test cleanup deletes the
  test organisation in dependency order (slices → allocations → org) plus
  its throwaway users.
- Live HTTP smoke test (built server, `GET /health` → `{"ok":true,
  "db":"up"}`): register/login, vehicle create → 201, duplicate VIN →
  409, `/api/state` snapshot, unauthenticated → 401.
- Frontend: `npm test` 9/9; `npm run build` passes in demo mode and with
  `VITE_API_URL` set. Auth paths are `/api/auth/*` on both sides.
- The live database currently holds **no organisations, users, or
  vehicles** — all test rows were deleted after verification. Demo seed
  data lives in the frontend local mode only, never in the database.
