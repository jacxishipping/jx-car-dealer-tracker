# JX Car Dealer Tracker — API Server

Node.js + TypeScript + Express (CommonJS) + PostgreSQL (`dealer` schema).
The frontend is a separate Vite app; this server owns only `server/`.

## Run

```bash
npm install
npm run migrate     # runs docs/schema.sql (idempotent) + offers table
npm run seed-admin  # ADMIN_EMAIL, ADMIN_PASSWORD, ORG_NAME from env
npm run dev         # tsx watch src/index.ts  (port 3001)
npm run build && npm start
npm test            # unit tests always run; integration tests need DATABASE_URL
```

## Environment (runtime only — never commit secrets, never create a `.env`)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Falls back to `POSTGRES_URL`, then `POSTGRES_PRISMA_URL` |
| `JWT_SECRET` | yes | No default; server refuses to start without it |
| `PORT` | no | Default `3001` |
| `CORS_ORIGIN` | no | Default `http://localhost:5173` (comma-separated list) |
| `JWT_EXPIRES_IN` | no | Default `1h` |
| `REFRESH_EXPIRES_DAYS` | no | Default `7` |

## Auth

- `POST /api/auth/register` `{orgName,name,email,password}` → 201
  `{token, refreshToken, user:{id,name,email,role}, organization:{id,name}}`
- `POST /api/auth/login` `{email,password,organizationId?}` → 200, same shape +
  `memberships[]`
- `POST /api/auth/refresh` `{refreshToken}` → 200 `{token, refreshToken}` (rotation;
  old token revoked, stored only as SHA-256 hash)
- `POST /api/auth/logout` `{refreshToken}` → 200 `{ok:true}`
- `GET /api/auth/me` → `{user, organization, memberships}`
- All other routes: `Authorization: Bearer <access token>`. The org always
  comes from the JWT — never from the request body.

## API contract (base `/api`, all org-scoped)

- `GET /health` (no auth) → `{ok:true, db:"up"|"down"}`
- `GET /api/state` → full `AppState` snapshot (frontend field names/casing) +
  `organization`, `currentRole`, `currentUser`
- Lists: `GET /api/{vehicles,purchases,transport,expenses,recon,parts,customers,
  leads,deals,sales,accounts,transactions,journal,receivables,documents,team,
  audit,notifications,offers}?q=&status=&page=1&limit=50` →
  `{data, total, page, limit}`. Single `GET /:id`, `POST` (201), `PATCH /:id`,
  `DELETE /:id` (soft delete) where sensible.
- `POST /api/purchases` `{seller, auction, purchaseDate, vehiclePrice, buyerFees,
  auctionFees, taxes, transportEstimate, paymentMethod, paymentStatus, documents,
  vehicle:{...}}` → `{purchase, vehicle}` (one transaction; duplicate VIN → 409)
- `POST /api/transport`, `PATCH /api/transport/:id` — `Delivered` adds the price
  to the vehicle `transport_cost` and flips `In transit` → `Received`
- `POST /api/parts/:id/batches`, `POST /api/parts/:id/allocate {vehicleId, qty}`
  → `{allocation, slices, fifoCost}` (400 on insufficient stock),
  `POST /api/parts/:id/return {allocationId, qty}`
- `POST /api/customers`, `POST /api/customers/:id/interactions`,
  `POST /api/leads`, `PATCH /api/leads/:id`, `POST /api/offers`
- `POST /api/deals`, `POST /api/deals/:id/finalize` → `{sale}` (atomic)
- `POST /api/receivables/:id/payments {amount, accountId}` (400 over outstanding),
  `POST /api/transactions/transfer {fromAccountId, toAccountId, amount, note}`,
  `POST /api/journal/:id/reverse`
- `GET /api/dashboard` → `{kpis, monthlySeries, forecast}` (forecast labelled `FORECAST`)
- `GET /api/reports/:name?from=&to=` — `inventory|sales|profitability|expenses|
  recon|parts-valuation|fifo|cashflow|balances|receivables|payables|pl|aging|crm|
  salesperson` → `{rows, summary}`
- `GET /api/settings`, `PATCH /api/settings`
- `POST /api/ai/operations {command}` → `{operation, result?}` (deterministic
  parser; sensitive commands never execute); `POST /api/ai/operations/:id/confirm
  {confirm, vin?, stockNumber?, askingPrice?}` (create_vehicle needs a VIN)
- `GET /api/mcp/tools` (19 tools); `POST /api/mcp/tools/:tool {arguments, confirm?}`
  → `{tool, result}`; sensitive writes without `confirm:true` return
  `{requiresConfirmation:true, preview}` and write nothing

## Notes / known deltas

- Money is `NUMERIC(12,2)` in the DB and JSON numbers in responses.
- `docs/schema.sql` ships 39 tables and **no `offers` table**; `migrate.ts` creates
  `dealer.offers` from `src/lib/schema-extras.ts` (schema.sql untouched).
- `customer.interestedVehicleIds` and vehicle `photos` have no storage columns;
  the API returns them as `[]` (photos are populated from `vehicle_photos` in
  `/api/state` only).
- Default money account: first Active Bank account, else first Active account,
  else an auto-created "Operating Bank" account (the frontend demo's `acc-bank`
  does not exist server-side).
- RBAC: Viewer read-only; Technician recon + vehicle status; Sales customers /
  leads / deals / sales; Accountant finance / expenses / reports; Manager all
  operational except `team.manage` / `settings.write`; Admin all except
  managing the Owner role; Owner all.
