# JX Car Dealer Tracker — Architecture

## 1. Repository audit — what exists locally

Three related artefacts exist in this workspace. They are not the same thing,
and this app deliberately depends on only one of them as a package.

| Artefact | Location | What it is |
|---|---|---|
| JXUI fixed source | `~/workspace/jxui-react-fixed/jxui-react-main/` (zip: `~/workspace/jxui-react-fixed/jxui-react-fixed.zip`) | The JXUI React library source after all 16 report issues (JX-01–JX-16) were fixed on 2026-11-06. Build passes, tests 31/31. Deployment of the fix is blocked on GitHub App write access to `jacxishipping/jxui-react`; nothing here depends on that push. |
| JXUI knowledgebase | `~/workspace/your_files/jxui-knowledgebase/jxui-knowledgebase.md` (5,641 lines) | Reference for all 361 JXUI components (61 showcases + 300 primitives, 18 categories), built from the live workbench inventory plus the fixed source above. Used as the authority for which components exist and what their props are. |
| This app | `~/workspace/jx-car-dealer-tracker/` (this repository) | A fresh Vite + React 19 + TypeScript dealer-tracker app, built from scratch on the JXUI 3.0.0 npm package. Own data model, own seed data, no data copied from any other tracker. |

## 2. Stack — chosen and why

| Choice | Version | Why |
|---|---|---|
| Vite | 8.3.6 | Fast dev/build; the JXUI ecosystem is Vite-first. |
| React | 19.3.1 | Required by JXUI 3.0.0 (peer `react >= 18`). |
| TypeScript | ~7.0.2 | Strict types for the money engine; `tsc -b` runs in the build. |
| Tailwind CSS | 4.3.5 (via `@tailwindcss/vite`) | Utility styling for layout; JXUI supplies the components. |
| `@jacxishippingorg/jx-ui-react` | ^3.0.0 (installed 3.0.0) | The Jacxi design system: 361 components, JXUI visual language (Indigo `#4f46e5`, light canvas `#F8FAFC`, white 16px cards, Plus Jakarta Sans). Verified to exist on npm: version 3.0.0 was published 2026-11-01T18:51:12Z (`npm view @jacxishippingorg/jx-ui-react@3.0.0`). |
| `lucide-react` | **pinned 0.546.0** | JXUI's bundle imports the `Github` icon. That icon exists in 0.546.0 (verified in `node_modules/lucide-react/dist/esm/icons/github.js`) and was removed in lucide-react 1.x (latest on npm is 1.71.0), so the pin is load-bearing: do not upgrade lucide-react past 0.x without checking the JXUI bundle first. |
| `motion` | ^14.12.0 | JXUI peer dependency (`motion >= 11`). |
| `react-router-dom` | ^7.18.5 | Routing. `HashRouter` is used deliberately: the built app is served as static files, so deep links must work without server-side SPA fallback. |
| vitest | ^5.1.0 | Unit tests for the pure engine (`src/store/engine.test.ts`). Test config lives in `vite.config.ts` (`environment: 'node'`, `include: ['src/**/*.test.ts']`). |
| oxlint | ^1.90.0 | Lint (`npm run lint`). |

No state-management library: the store is one React context + reducer
(`src/store/store.tsx`) over a single `AppState`. That is a deliberate choice
for a demo-scale app — every module reads/writes the same records, and the
money engine (`src/store/engine.ts`) is pure functions with no React or I/O,
so it is unit-testable and portable to a server later.

## 3. JXUI component inventory — what is actually imported

Method: `grep` over `src/` for `import { … } from
'@jacxishippingorg/jx-ui-react'`, then verified each name against the
installed package types under
`node_modules/@jacxishippingorg/jx-ui-react/dist-lib/types/components/`.
Only 9 of the 361 components are imported. Nothing below is claimed from the
knowledgebase alone — every entry is an import that exists in `src/`.

| Component | Imported by | Used for |
|---|---|---|
| `JXThemeProvider` | `src/App.tsx` | App-wide JXUI theme (`defaultMode="light"`). |
| `JXAlert` | `src/components/ui.tsx`, `src/pages/Sales.tsx`, `src/pages/AiAssistant.tsx`, `src/pages/Mcp.tsx` | Severity banners (`severity`, `title`, `description`); the `Alert` helper in `ui.tsx` wraps it. |
| `JXAvatar` | `src/components/Layout.tsx`, `src/pages/Team.tsx` | Current-user avatar in the top bar; team member avatars. |
| `JXButton` | `src/components/ui.tsx`, `src/components/Layout.tsx`, `src/pages/Inventory.tsx`, `Purchases.tsx`, `Transportation.tsx`, `Expenses.tsx`, `Reconditioning.tsx`, `Sales.tsx`, `CRM.tsx`, `Parts.tsx`, `Finance.tsx`, `Reports.tsx`, `Documents.tsx`, `Team.tsx`, `Settings.tsx`, `AiAssistant.tsx`, `Mcp.tsx` (17 files) | All buttons (`variant: contained/soft/outlined/text/glass`, `size`, `color`, `disabled`, `onClick`). |
| `JXCard` | `src/components/ui.tsx`, `src/pages/Dashboard.tsx`, `VehicleDetail.tsx`, `Reconditioning.tsx`, `Sales.tsx`, `CRM.tsx`, `Parts.tsx`, `Finance.tsx`, `Analytics.tsx`, `Reports.tsx`, `Team.tsx`, `Settings.tsx`, `AiAssistant.tsx`, `Mcp.tsx` (14 files) | Content cards (`title`, `kicker`, `description`, `children`, `className`); `KpiCard` in `ui.tsx` wraps it. |
| `JXChip` | `src/components/ui.tsx`, `src/pages/CRM.tsx`, `src/pages/AiAssistant.tsx`, `src/pages/Mcp.tsx` | Status pills (`label`, `tone`); `StatusChip` in `ui.tsx` maps every status string to a tone. |
| `JXSelect` | `src/components/Layout.tsx`, `src/pages/Inventory.tsx`, `VehicleDetail.tsx`, `Purchases.tsx`, `Transportation.tsx`, `Expenses.tsx`, `Sales.tsx`, `CRM.tsx`, `Parts.tsx`, `Finance.tsx`, `Documents.tsx`, `Team.tsx`, `Settings.tsx` (13 files) | Dropdowns (`options: [{id, label}]`, `value`, `onChange(val)`, `label`, `placeholder`); role switcher in the top bar. |
| `JXSwitch` | `src/pages/Team.tsx`, `src/pages/Settings.tsx` | Toggles (`checked`, `onChange(checked)`, `label`): member active/inactive, settings flags. |
| `JXTextField` | `src/pages/Inventory.tsx`, `Sales.tsx`, `CRM.tsx`, `Parts.tsx`, `Finance.tsx`, `Documents.tsx`, `Team.tsx`, `Settings.tsx` (8 files) | Text inputs (`value`, `onChange(val)`, `label`, `placeholder`). |

Everything else in the UI is local and styled to the JXUI language: tables,
modals and charts are hand-built in `src/components/ui.tsx` (local `Modal`,
`BarChart`, `Donut`, `usePagination`), and `src/components/Layout.tsx` is a
local shell (sidebar, top bar, notifications). Icons are `lucide-react`
throughout.

### 3.1 Components deliberately NOT used — and why

| Component | Why not |
|---|---|
| `JXTable` | Verified in `dist-lib/types/components/data-display/JXTable.d.ts`: its rows are a fixed shape — `JXTableRowData { id, service, env, latency, commit, detail }` — a service-health table, not a generic data table. It cannot render vehicle/expense/sale rows, so all tables are local. |
| `KanbanBoard` | Does not exist. No `KanbanBoard` export appears anywhere in the installed package types or in the 361-component knowledgebase. The closest real exports are `KanbanTable` (a table viewable as kanban cards, `library/datagrids`) and `KineticKanban` (below). Do not import it. |
| `KineticKanban` | Exists (`library/dragdrop/KineticKanban.d.ts`) but is demo-only: it is declared as a bare `React.FC` with no props — no data, columns, or callbacks. The leads pipeline is therefore a local board in `CRM.tsx`, not a JXUI component. |
| `JXBadge` | A count badge, not a status pill — `JXChip` covers statuses. (Noted in `src/components/ui.tsx`.) |

Rule for future work: verify a component in the installed package types
before importing it; the knowledgebase lists 361 components, but most are
showcases or demo-only primitives with no usable props.

## 4. Proposed system architecture

### 4.1 This build (frontend only)

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (static files, HashRouter)                          │
│  JXThemeProvider → Layout (sidebar/top bar) → 18 pages      │
│  src/components/ui.tsx — JXUI wrappers + local tables/charts│
│  src/components/LoginScreen.tsx — sign-in / register        │
│    (API mode only; demo mode never shows it)                │
│  src/lib/api.ts — production API client (JWT auth,          │
│    auto-refresh on 401, one typed fn per mutation)          │
│  src/store/store.tsx — one context + reducer (AppState)     │
│    Demo mode: localStorage. API mode (VITE_API_URL set):    │
│    state loads from GET /api/state, writes go through the   │
│    API and reload the server snapshot; role comes from the  │
│    server, setRole is a no-op, resetDemo reloads.           │
│  src/store/engine.ts — pure money engine (FIFO, all-in      │
│    cost, deal profit, KPIs, forecast) — unit-tested         │
│  src/store/seed.ts — labelled DEMO data (14 vehicles,       │
│    2 sales, 5 parts, 7 customers, 6 leads)                  │
│  localStorage key jx-dealer-tracker-v1 (demo persistence)   │
└─────────────────────────────────────────────────────────────┘
```

Money flow invariant (enforced in the store, to be enforced server-side in
production): every money movement goes through `recordTransaction()`-style
writes that post a journal entry alongside the transaction — a balance can
never change without a ledger entry. Sale finalisation is one atomic
`setState`: vehicle → Sold, deal → Finalized, sale + transaction + journal
entry written, lead → Sold, receivable opened for any outstanding balance.

### 4.2 Production target

```
MCP clients / AI assistant ─┐
Web app (this repo) ────────┤
                            ▼
              API server (Node/TS) — auth, RBAC, validation,
              FIFO + costing engine (ported from src/store/engine.ts),
              audit logging, MCP endpoint (tools in src/pages/Mcp.tsx)
                            │
              PostgreSQL (docs/schema.sql) — multi-tenant by
              organization_id; UNIQUE VIN per organization (live rows)
                            │
              Object storage — vehicle photos, documents
              (vehicle_photos.storage_key, documents.storage_key)
```

Migration path: the engine functions are already pure and database-free, so
they port verbatim to the server; the store's `addVehicle` / `recordPurchase` /
`finalizeSale` / `recordPayment` / `allocatePart` become API endpoints with
the same guards (duplicate VIN, overpayment, insufficient FIFO stock,
sellable statuses) enforced in transactions; `localStorage` is replaced by
the API, and the seed becomes an optional demo-data loader.

Frontend wiring for that target is done: `src/lib/api.ts` implements the
contract (auth under `/api/auth/*`, resources under `/api/*`, Bearer token with
one auto-refresh on 401), `src/store/store.tsx` runs in API mode when
`VITE_API_URL` is set, and `src/App.tsx` gates on the login screen when
there is no token. The `server/` backend implements the API and PostgreSQL
migrations in `server/src/migrate.ts`. Deployment of both halves is in `docs/DEPLOYMENT.md`.

## 5. PostgreSQL schema — `docs/schema.sql`

One schema (`dealer`), multi-tenant by `organization_id` on every
tenant-owned row. 39 tables in `docs/schema.sql` plus `dealer.offers`
in `server/src/lib/schema-extras.ts` (40 tables total):

- **Tenancy / identity:** `organizations`, `users`, `roles`, `permissions`,
  `role_permissions`, `organization_members`.
- **Vehicles:** `vehicles`, `vehicle_photos`, `vehicle_documents`,
  `vehicle_purchases`, `transportation_orders`, `transportation_events`.
- **Costs:** `vendors`, `expense_categories`, `expenses`,
  `reconditioning_jobs`.
- **CRM / sales:** `customers`, `customer_interactions`, `leads`, `deals`,
  `sales`.
- **Finance:** `accounts`, `financial_transactions`, `journal_entries`,
  `journal_entry_lines`, `receivables`, `payments`.
- **Parts (FIFO):** `parts`, `part_batches`, `part_movements`,
  `part_allocations`, `part_allocation_slices`, `purchase_orders`.
- **Platform:** `documents`, `notifications`, `audit_logs`,
  `ai_operations`, `settings`.

Key decisions (all visible in the file):

- Money is `NUMERIC(12,2)`, never `FLOAT`.
- `UNIQUE (organization_id, upper(vin)) WHERE deleted_at IS NULL` — unique
  VIN per organization over live rows only, so a soft-deleted vehicle frees
  its VIN. Stock numbers get the same treatment.
- Soft delete everywhere tenant data lives (`deleted_at TIMESTAMPTZ`);
  `audit_logs` is the exception — append-only, no `updated_at`, no
  `deleted_at`, never updated or deleted.
- `receivables` models both sides: `kind = 'Customer'` is money owed to the
  dealer; `Vendor`/`Carrier` is money owed by the dealer. `CHECK (paid <=
  total)` blocks overpayment at the database level.
- `journal_entry_lines` requires one side zero per line; balanced entries
  (`sum(debit) = sum(credit)`) are enforced in application code plus a
  periodic reconciliation check.
- `part_allocation_slices` is the FIFO paper trail: which batch slices each
  allocation consumed, at which unit price.
- `ai_operations` records every assistant command (raw text, parsed kind and
  payload, status `proposed → confirmed → executed / cancelled / rejected`);
  sensitive commands are stored as `rejected`, never executed.
- `deals.sale_id` is added by `ALTER TABLE` after `sales` exists (forward
  foreign key); the file avoids extensions entirely (`gen_random_uuid()` is
  built into PostgreSQL 13+, email uniqueness is a `lower(email)` index).
- Executed idempotently via `server/src/migrate.ts` (together with
  `server/src/lib/schema-extras.ts`) against PostgreSQL (`40` tables
  verified in schema `dealer`; see `docs/DEPLOYMENT.md`).

## 6. Module implementation plan

Status of the 18 routes in `src/App.tsx` (all wired, all render):

| Module | Route | Status in this build |
|---|---|---|
| Dashboard | `/` | Working — KPIs, charts, alerts from live store. |
| Inventory / Vehicle detail | `/inventory`, `/inventory/:id` | Working — CRUD via store, VIN duplicate guard. |
| Purchases | `/purchases` | Working — `recordPurchase` with Paid/Partial/Unpaid handling. |
| Transportation | `/transportation` | Working — delivery adds transport price to vehicle cost basis. |
| Expenses | `/expenses` | Working — Direct vs Overhead, Paid posts transaction + journal. |
| Reconditioning | `/reconditioning` | Working — job tracking linked to expenses. |
| Sales | `/sales` | Working — deal draft → atomic finalisation (see §4.1). |
| CRM / Clients | `/crm` | Working — customers, leads pipeline, interactions, offers. |
| Parts Inventory | `/parts` | Working — FIFO allocation, batch receipt, low-stock alerts. |
| Finance | `/finance` | Working — accounts, transactions, journal, receivables, payments, transfers. |
| Analytics | `/analytics` | Working — monthly series + labelled FORECAST (never actuals). |
| Reports | `/reports` | Working — CSV exports. |
| Documents | `/documents` | Working as metadata — file names/sizes recorded; no file bytes stored. |
| Team & Permissions | `/team` | Working — role switching is a demo control, not server RBAC. |
| Settings | `/settings` | Working — org name, currency, hold-days target, overhead, theme. |
| AI Assistant | `/ai-assistant` | Working — deterministic parser, confirm-before-execute, sensitive ops never executed from a command. See `src/pages/AiAssistant.tsx`. |
| MCP | `/mcp` | Documentation + in-app tool registry only — not a live server. See `src/pages/Mcp.tsx`. |

Production work, in order: (1) API server + PostgreSQL (`docs/schema.sql`)
with the store's guards moved into transactions — the server is a separate
build; the frontend side (API client, store API mode, login gate) is done
and documented in `docs/DEPLOYMENT.md`; (2) real auth + server RBAC (the
in-app role switcher is presentation only in demo mode; in API mode the
role comes from the server and the switcher is a no-op); (3) object storage
for photos/documents; (4) live MCP server implementing the 19 documented
tools; (5) voice input + OCR for the assistant (currently visual-only /
filename-only); (6) multi-organization onboarding and demo-data reset as a
server feature.

## 7. Technical risks

1. **Demo persistence is localStorage.** Data lives in one browser, one key
   (`jx-dealer-tracker-v1`). Clearing storage, or opening another browser,
   loses edits. Mitigation: `resetDemo()` restores the seed; production
   replaces this with the API.
2. **Role switching is client-side only.** `currentRole` gates UI affordances,
   not data. Nothing in this build stops a determined user from calling a
   store function directly. Server RBAC is a precondition for any shared
   deployment.
3. **FIFO depends on batch dates.** `fifoConsume` orders by `purchaseDate`
   then `id`; back-dated or mis-dated batches silently change costing.
   Server-side, batch creation should stamp the server date.
4. **Seed sale snapshot — fixed at integration (was a $150 gap).** The brief's
   hand-written `s-001` snapshot recorded `totalCost: 12890` (gross 3010, net
   2890), but `vehicleAllInCost()` recomputes 12740 for `v-004` (11200 + 380
   + 550 + 460 direct + 0 parts + 150 overhead = 12740, not 12890 — the
   brief's own arithmetic was wrong by the same $150). The seed snapshot,
   journal JE-0001 COGS lines, and audit a-001 were corrected at integration
   to the engine values (totalCost 12740, gross 3160, net 3040, margin
   19.1%); `src/store/engine.test.ts` (c), (d) and (f) now assert the engine
   and the seed agree exactly. The engine is authoritative; the seed is a
   snapshot.
5. **lucide-react pin (0.546.0).** JXUI's bundle imports the `Github` icon,
   removed in lucide-react 1.x. Upgrading lucide-react will break the JXUI
   build until JXUI drops that import.
6. **JXUI showcase components are mostly demo-only.** Most of the 361
   components (e.g. `KineticKanban`) accept no props. Only the 9 components
   in §3 are verified usable here; verify in the installed types before
   adopting more.
7. **No live MCP / voice / OCR.** The MCP page documents a future server;
   the assistant's voice button and photo input are explicitly unconnected
   (see §8). Any integration claiming otherwise is wrong.

## 8. Honest scope note — what works vs what needs a production backend

**Fully working in this build** (in-browser, demo data, no server): all 18
pages; vehicle/purchase/transport/expense/recon/sale/CRM/parts/finance
workflows; FIFO parts costing; all-in cost and deal-profit math (unit-tested,
`npm test`); CSV exports; audit trail for store writes; the AI Assistant's
deterministic parser with Before/After preview and explicit confirm; the MCP
tool registry as documentation.

**Not in this build — needs a production backend:** PostgreSQL (schema
designed in `docs/schema.sql`, never executed by the frontend); real
authentication and server-side RBAC — in demo mode the role switcher is
still presentation-only, while in API mode auth/RBAC come from the server
in `server/` (frontend wired, server built separately); multi-user /
multi-organization data (same split); object storage for photo and
document bytes (only file names are recorded); a live MCP server (the
`/mcp` page is docs + registry, not an endpoint); voice input (the
assistant's Voice button is visual-only and says so); OCR (the photo picker
records only the file name and says so); any AI backend (the assistant is a
deterministic parser, and says so); email, notifications delivery, and
payment processing. Deployment of the backend is covered in
`docs/DEPLOYMENT.md`.
