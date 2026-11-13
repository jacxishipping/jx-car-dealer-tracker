# JX Car Dealer Tracker

A dealership management app for a small car dealer: inventory, purchases,
transportation, expenses, reconditioning, sales, CRM, parts (FIFO), finance,
analytics, reports, documents, team & permissions, settings — plus an AI
Voice-to-Work assistant (deterministic parser) and MCP integration
documentation. Built with Vite + React 19 + TypeScript and the JXUI 3.0.0
component library.

## Stack

- **Vite 8.3.6 + React 19.3.1 + TypeScript ~7.0.2** — `tsc -b && vite build`.
- **Tailwind CSS 4.3.5** (via `@tailwindcss/vite`) for layout styling.
- **`@jacxishippingorg/jx-ui-react` 3.0.0** — the Jacxi design system
  (361 components). Verified to exist on npm: version 3.0.0 was published
  2026-11-01 (`npm view @jacxishippingorg/jx-ui-react@3.0.0`). Only 9 of its
  components are actually imported in `src/` — see `docs/ARCHITECTURE.md`
  §3 for the verified list (among them `JXThemeProvider`, `JXButton`,
  `JXCard`, `JXChip`, `JXSelect`, `JXTextField`).
- **`lucide-react` pinned to 0.546.0** — pinned deliberately: JXUI's bundle
  imports the `Github` icon, which exists in 0.546.0 and was removed in
  lucide-react 1.x (latest on npm is 1.71.0). Do not upgrade lucide-react
  past 0.x without checking the JXUI bundle first.
- **`motion` 14.12.0, `react-router-dom` 7.18.5** — JXUI peer dependency and
  routing (`HashRouter`, so the static build works without server-side SPA
  fallback).
- **vitest 5.1.0** — unit tests for the pure money engine.

## How to run

```bash
npm install
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build
npm run preview  # serve the production build
npm test         # vitest run — engine tests in src/store/engine.test.ts
npm run lint     # oxlint
```

### Demo mode vs API mode

By default (`VITE_API_URL` unset) the app runs in **demo mode**: seed data
in localStorage, no login, no server. Set `VITE_API_URL` to the production
API server URL and the app switches to **API mode**: a login screen appears,
state loads from `GET /api/state`, and every write goes through the API
(`src/lib/api.ts`) with the server as the single source of truth. Full
setup, environment variables and deployment steps: `docs/DEPLOYMENT.md`.

```bash
VITE_API_URL=http://localhost:3001 npm run dev   # API mode, local server
```

## Demo data

The app ships with labelled **DEMO** seed data (`src/store/seed.ts`): 14
vehicles, 3 purchases, 4 transport orders, 10 expenses, 5 parts with FIFO
batches, 7 customers, 6 leads, 4 deals, 2 sales. State persists in the
browser under localStorage key `jx-dealer-tracker-v1`; **Reset demo data**
(in Settings) restores the seed. Nothing leaves the browser — there is no
server, no account, and no real customer data.

In **API mode** (`VITE_API_URL` set) the demo seed is not used: state comes
from the server's PostgreSQL database, nothing is written to localStorage,
**Reset demo data** reloads from the server instead of reseeding, and the
role switcher is disabled — the role comes from the server. See
`docs/DEPLOYMENT.md`.

## Project structure

```
src/
  App.tsx            # JXThemeProvider + StoreProvider + HashRouter, 18 routes
  main.tsx           # entry point
  index.css          # Tailwind + fonts
  components/
    Layout.tsx       # sidebar, top bar, role switcher, notifications
    ui.tsx           # JXUI wrappers (KpiCard, StatusChip, Alert, Modal,
                     #   charts) + local tables/pagination
    LoginScreen.tsx  # sign-in / create-organization screen (API mode only)
  lib/
    csv.ts           # CSV export helper
    api.ts           # production API client (auth + all mutations);
                     #   active only when VITE_API_URL is set (API_MODE)
  pages/             # one file per module (Dashboard, Inventory,
                     #   VehicleDetail, Purchases, Transportation, Expenses,
                     #   Reconditioning, Sales, CRM, Parts, Finance,
                     #   Analytics, Reports, Documents, Team, Settings,
                     #   AiAssistant, Mcp)
  store/
    types.ts         # data model (single source of truth) + fmtMoney
    engine.ts        # pure money engine: FIFO, all-in cost, deal profit,
                     #   KPIs, forecast — no React, no I/O
    engine.test.ts   # vitest tests for the engine
    store.tsx        # React context + reducer; every money move posts a
                     #   journal entry; sale finalisation is atomic
    seed.ts          # demo data
docs/
  ARCHITECTURE.md    # repository audit, verified JXUI inventory, proposed
                     #   system architecture, module plan, risks, scope note
  DEPLOYMENT.md      # run locally, env vars, Neon, Vercel frontend +
                     #   Render/Railway/VPS server deploys, health, backups
  schema.sql         # PostgreSQL DDL for the production backend (39 base
                     #   tables + dealer.offers in server/src/lib/schema-extras.ts)
server/              # production API (Node/TS + PostgreSQL) — built
                     #   alongside this frontend; see docs/DEPLOYMENT.md
vercel.json          # Vite build, dist output, SPA rewrite to /index.html
.env.example         # placeholder env vars only — never real values
```

## Key behaviours

- **All-in cost** per vehicle = purchase + auction fees + transport +
  direct expenses + FIFO parts + allocated overhead ($150/vehicle).
  Computed by `vehicleAllInCost()` in `src/store/engine.ts`.
- **FIFO parts costing** — oldest batch first; consuming 10 @ $50 + 2 @ $60
  costs $620. Insufficient stock throws instead of going negative.
- **Deal profit** — selling price − discount − total cost − taxes/fees.
  Seed sale SALE-0001: $12,740 all-in cost → $3,160 gross, $3,040 net
  (~19.1% margin). (The brief's hand-written figures for this sale were
  $12,890 / $3,010 / $2,890 — its own components sum to $12,740; the seed
  was corrected at integration so it agrees with the engine, and
  `src/store/engine.test.ts` (c)/(d)/(f) assert the agreement.)
- **Money invariant** — every money movement writes a journal entry next to
  its transaction; a balance can never change without a ledger entry.
- **VIN uniqueness** — adding a vehicle with a duplicate VIN is rejected
  (store-level; the production schema enforces it per organization).
- **AI Assistant** (`/ai-assistant`) — a deterministic text-command parser,
  **not** an AI backend. It handles add-vehicle, record-transport,
  record-expense, aged-stock, losing-money and follow-up queries. Every
  write shows a Before/After preview and waits for an explicit Confirm.
  Sales, purchases, payments, refunds and deletions are never executed
  from a command. The Voice button is visual-only and the photo picker
  records only the file name (no OCR) — both say so on the page.
- **MCP** (`/mcp`) — documentation and an in-app registry for 11 READ and
  8 WRITE tools, each with its input schema, auth/confirmation rules, and
  the store function that implements it. It is **not** a live MCP server.

## Honest scope note

This build is a fully working **in-browser demo**: all 18 pages, all
workflows above, unit-tested money math, CSV export, and an audit trail.
With `VITE_API_URL` set it runs in **API mode** against the production
backend in `server/` (Node/TS + PostgreSQL, JWT auth, server-side RBAC,
multi-user/multi-organization data) — the frontend is wired for it
(`src/lib/api.ts`, store API mode, login screen; see `docs/DEPLOYMENT.md`),
and the server in `server/` has been implemented and verified against
PostgreSQL. Demo mode remains fully working with no server at all.

Still **not** in this build: **no** object storage (only file names are
recorded), **no** live MCP server, **no** voice input, **no** OCR, and
**no** AI backend. See `docs/ARCHITECTURE.md` §8 for the full list and
the production plan.
