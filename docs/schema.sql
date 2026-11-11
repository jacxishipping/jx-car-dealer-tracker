-- JX Car Dealer Tracker — PostgreSQL schema (production target)
-- ============================================================================
-- STATUS: production migration. Idempotent (IF NOT EXISTS throughout) and
-- safe to re-run. Executed against the Neon database by server/src/migrate.ts.
-- Includes dealer.refresh_tokens (JWT refresh-token rotation) in addition to
-- the original tables; re-running never drops or alters existing data.
--
-- Conventions
--   * All tables live in the `dealer` schema and are multi-tenant:
--     every tenant-owned row carries organization_id.
--   * Primary keys are UUIDs (gen_random_uuid()); human refs (ACQ-0001,
--     DEAL-0001, SALE-0001) are separate unique columns.
--   * Money is NUMERIC(12,2) in USD; never FLOAT.
--   * Soft delete: deleted_at TIMESTAMPTZ NULL (NULL = live). Unique
--     constraints that must survive soft delete use a partial index or
--     include deleted_at in the key — see the VIN index below.
--   * created_at / updated_at are maintained by the updated_at trigger.
--   * The app's current store (src/store/*) is the in-browser equivalent of
--     this schema; field names mirror src/store/types.ts where possible.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS dealer;
SET search_path = dealer, public;

-- No extensions are required: gen_random_uuid() is built into PostgreSQL 13+.
-- (CITEXT is deliberately avoided for the same reason; email uniqueness is
-- case-insensitive via a lower(email) index — see users below.)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dealer.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Tenancy, identity and access control
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer.organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  target_hold_days INT NOT NULL DEFAULT 45 CHECK (target_hold_days >= 0),
  overhead_per_vehicle NUMERIC(12,2) NOT NULL DEFAULT 150.00 CHECK (overhead_per_vehicle >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
COMMENT ON TABLE dealer.organizations IS 'Dealership tenant. One organization = one dealership.';

CREATE TABLE IF NOT EXISTS dealer.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  -- Password hashes live here ONLY if the backend owns auth; with an external
  -- IdP this column stays NULL and external_subject is the source of truth.
  password_hash TEXT,
  external_subject TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
COMMENT ON TABLE dealer.users IS 'People. A user may belong to several organizations via organization_members.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci ON dealer.users (lower(email));

CREATE TABLE IF NOT EXISTS dealer.roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (name IN ('Owner','Admin','Manager','Sales','Accountant','Technician','Viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, name)
);
COMMENT ON TABLE dealer.roles IS 'Role names mirror the app roles in src/store/types.ts.';

CREATE TABLE IF NOT EXISTS dealer.permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,  -- e.g. 'vehicle.create', 'sale.finalize', 'payment.record'
  description TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE dealer.permissions IS 'Fine-grained permission codes; roles map to them via role_permissions (below).';

CREATE TABLE IF NOT EXISTS dealer.role_permissions (
  role_id       UUID NOT NULL REFERENCES dealer.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES dealer.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS dealer.organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES dealer.users(id) ON DELETE CASCADE,
  role_id         UUID NOT NULL REFERENCES dealer.roles(id) ON DELETE RESTRICT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON dealer.organization_members (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON dealer.organization_members (user_id);

-- ---------------------------------------------------------------------------
-- Auth: refresh tokens (JWT rotation). One row per issued refresh token;
-- the token itself is stored only as a SHA-256 hash, never in plain text.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer.refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES dealer.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON dealer.refresh_tokens (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON dealer.refresh_tokens (token_hash);

-- ---------------------------------------------------------------------------
-- Vehicles and their lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer.vehicles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  stock_number    TEXT NOT NULL,
  vin             TEXT NOT NULL,
  year            INT NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  make            TEXT NOT NULL,
  model           TEXT NOT NULL,
  trim            TEXT NOT NULL DEFAULT '',
  ext_color       TEXT NOT NULL DEFAULT '',
  int_color       TEXT NOT NULL DEFAULT '',
  mileage         INT NOT NULL DEFAULT 0 CHECK (mileage >= 0),
  transmission    TEXT NOT NULL DEFAULT '',
  engine          TEXT NOT NULL DEFAULT '',
  fuel            TEXT NOT NULL DEFAULT 'Petrol',
  drivetrain      TEXT NOT NULL DEFAULT '',
  body_type       TEXT NOT NULL DEFAULT '',
  condition       TEXT NOT NULL DEFAULT 'Good' CHECK (condition IN ('Excellent','Good','Fair','Poor')),
  title_status    TEXT NOT NULL DEFAULT 'Clean' CHECK (title_status IN ('Clean','Salvage','Rebuilt','Lien','Missing')),
  status          TEXT NOT NULL DEFAULT 'Purchased' CHECK (status IN ('Purchased','Awaiting pickup','In transit','Received','Inspection','In reconditioning','Available','Reserved','Sold','Returned','Wholesale')),
  purchase_date   DATE NOT NULL,
  purchase_source TEXT NOT NULL DEFAULT 'Other dealer' CHECK (purchase_source IN ('Auction','Wholesale','Private seller','Trade-in','Other dealer')),
  purchase_price  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  auction_fees    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (auction_fees >= 0),
  transport_cost  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (transport_cost >= 0),
  asking_price    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (asking_price >= 0),
  min_price       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_price >= 0),
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
-- UNIQUE VIN per organization, over live rows only (a soft-deleted vehicle
-- frees its VIN for re-use; a duplicate live VIN is rejected).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_org_vin_live
  ON dealer.vehicles (organization_id, upper(vin)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_org_stock_live
  ON dealer.vehicles (organization_id, stock_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_org_status ON dealer.vehicles (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicles_org_purchase_date ON dealer.vehicles (organization_id, purchase_date);
COMMENT ON TABLE dealer.vehicles IS 'One row per vehicle. All-in cost = purchase_price + auction_fees + transport_cost + direct expenses + FIFO parts + overhead (see engine.vehicleAllInCost).';

CREATE TABLE IF NOT EXISTS dealer.vehicle_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  vehicle_id    UUID NOT NULL REFERENCES dealer.vehicles(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,  -- object-storage key, e.g. 'org/<id>/vehicles/<vin>/front.jpg'
  file_name     TEXT NOT NULL,
  file_size     BIGINT NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  content_type  TEXT NOT NULL DEFAULT 'image/jpeg',
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vehicle_photos_vehicle ON dealer.vehicle_photos (vehicle_id, sort_order);

CREATE TABLE IF NOT EXISTS dealer.vehicle_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  vehicle_id    UUID NOT NULL REFERENCES dealer.vehicles(id) ON DELETE CASCADE,
  document_id   UUID,  -- FK to dealer.documents added below (documents is defined later in this file)
  kind          TEXT NOT NULL,  -- 'title', 'bill_of_sale', 'inspection', ...
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle ON dealer.vehicle_documents (vehicle_id);

-- ---------------------------------------------------------------------------
-- Purchasing and transportation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer.vehicle_purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  ref             TEXT NOT NULL,  -- ACQ-0001
  vehicle_id      UUID NOT NULL REFERENCES dealer.vehicles(id) ON DELETE RESTRICT,
  seller          TEXT NOT NULL,
  auction         TEXT NOT NULL DEFAULT '',
  purchase_date   DATE NOT NULL,
  vehicle_price   NUMERIC(12,2) NOT NULL CHECK (vehicle_price >= 0),
  buyer_fees      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (buyer_fees >= 0),
  auction_fees    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (auction_fees >= 0),
  taxes           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (taxes >= 0),
  transport_estimate NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (transport_estimate >= 0),
  payment_method  TEXT NOT NULL DEFAULT '',
  payment_status  TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Paid','Partial','Unpaid')),
  documents       TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_purchases_vehicle ON dealer.vehicle_purchases (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_purchases_org_date ON dealer.vehicle_purchases (organization_id, purchase_date);

CREATE TABLE IF NOT EXISTS dealer.transportation_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  vehicle_id      UUID NOT NULL REFERENCES dealer.vehicles(id) ON DELETE RESTRICT,
  carrier         TEXT NOT NULL,
  driver          TEXT NOT NULL DEFAULT '',
  pickup_location TEXT NOT NULL DEFAULT '',
  delivery_location TEXT NOT NULL DEFAULT '',
  pickup_date     DATE,
  expected_delivery DATE,
  actual_delivery DATE,
  price           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  status          TEXT NOT NULL DEFAULT 'Awaiting pickup' CHECK (status IN ('Awaiting pickup','Scheduled','Picked up','In transit','Delivered','Delayed','Cancelled')),
  gate_pass       TEXT NOT NULL DEFAULT '',
  bill_of_lading  TEXT NOT NULL DEFAULT '',
  damage_notes    TEXT NOT NULL DEFAULT '',
  invoice_ref     TEXT NOT NULL DEFAULT '',
  payment_status  TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Paid','Partial','Unpaid')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_transport_vehicle ON dealer.transportation_orders (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_transport_org_status ON dealer.transportation_orders (organization_id, status);

CREATE TABLE IF NOT EXISTS dealer.transportation_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES dealer.transportation_orders(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transport_events_order ON dealer.transportation_events (order_id, occurred_at);
COMMENT ON TABLE dealer.transportation_events IS 'Append-only status history for a transport order (pickup, delays, delivery).';

-- ---------------------------------------------------------------------------
-- Vendors, expenses and reconditioning
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer.vendors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'Other',  -- 'Garage', 'Carrier', 'Auction', 'Parts supplier', ...
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS dealer.expense_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  -- organization_id NULL = built-in category shared by all organizations.
  name            TEXT NOT NULL,
  kind_default    TEXT NOT NULL DEFAULT 'Direct' CHECK (kind_default IN ('Direct','Overhead')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
COMMENT ON TABLE dealer.expense_categories IS 'Seed with the app categories: Mechanical repairs, Bodywork, Paint, Detailing, Tires, Battery, Glass, Inspection, Parts, Labor, Transportation, Auction fees, Advertising, Rent, Utilities, Insurance, Payroll, Other overhead.';
-- Built-in categories share organization_id NULL, and PostgreSQL unique
-- constraints treat NULLs as distinct — this partial index is what actually
-- prevents duplicate built-in category names.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_categories_builtin ON dealer.expense_categories (name) WHERE organization_id IS NULL;

CREATE TABLE IF NOT EXISTS dealer.expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category_id     UUID REFERENCES dealer.expense_categories(id) ON DELETE SET NULL,
  category_name   TEXT NOT NULL,  -- denormalised label kept for reporting if the category is deleted
  date            DATE NOT NULL,
  vendor_id       UUID REFERENCES dealer.vendors(id) ON DELETE SET NULL,
  vendor_name     TEXT NOT NULL DEFAULT '',
  vehicle_id      UUID REFERENCES dealer.vehicles(id) ON DELETE SET NULL,  -- NULL = general overhead
  kind            TEXT NOT NULL CHECK (kind IN ('Direct','Overhead')),
  payment_method  TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Paid','Pending')),
  invoice_ref     TEXT NOT NULL DEFAULT '',
  created_by      UUID REFERENCES dealer.users(id) ON DELETE SET NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_expenses_org_vehicle ON dealer.expenses (organization_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_expenses_org_date ON dealer.expenses (organization_id, date);
CREATE INDEX IF NOT EXISTS idx_expenses_org_category ON dealer.expenses (organization_id, category_name);

CREATE TABLE IF NOT EXISTS dealer.reconditioning_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  vehicle_id      UUID NOT NULL REFERENCES dealer.vehicles(id) ON DELETE RESTRICT,
  title           TEXT NOT NULL,
  category_id     UUID REFERENCES dealer.expense_categories(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'Not started' CHECK (status IN ('Not started','In progress','Done')),
  technician      TEXT NOT NULL DEFAULT '',
  estimated_cost  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
  actual_cost     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (actual_cost >= 0),
  started_at      DATE,
  completed_at    DATE,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_recon_vehicle ON dealer.reconditioning_jobs (vehicle_id, status);

-- ---------------------------------------------------------------------------
-- Customers, leads and deals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer.customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  preferred_contact TEXT NOT NULL DEFAULT 'Phone' CHECK (preferred_contact IN ('Phone','Email','WhatsApp')),
  budget          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  lead_source     TEXT NOT NULL DEFAULT '',
  salesperson     TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_customers_org_name ON dealer.customers (organization_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_org_email ON dealer.customers (organization_id, email);

CREATE TABLE IF NOT EXISTS dealer.customer_interactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES dealer.customers(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('Call','Email','WhatsApp','Visit','Test drive')),
  date            DATE NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  salesperson     TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_interactions_customer ON dealer.customer_interactions (customer_id, date DESC);

CREATE TABLE IF NOT EXISTS dealer.leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES dealer.customers(id) ON DELETE CASCADE,
  stage           TEXT NOT NULL DEFAULT 'New Lead' CHECK (stage IN ('New Lead','Contacted','Viewing','Negotiation','Sold','Lost')),
  follow_up_date  DATE NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leads_org_followup ON dealer.leads (organization_id, follow_up_date);
CREATE INDEX IF NOT EXISTS idx_leads_customer ON dealer.leads (customer_id, stage);

CREATE TABLE IF NOT EXISTS dealer.deals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  ref             TEXT NOT NULL,  -- DEAL-0001
  vehicle_id      UUID NOT NULL REFERENCES dealer.vehicles(id) ON DELETE RESTRICT,
  customer_id     UUID NOT NULL REFERENCES dealer.customers(id) ON DELETE RESTRICT,
  salesperson     TEXT NOT NULL DEFAULT '',
  selling_price   NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
  discount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  taxes           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (taxes >= 0),
  fees            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  deposit         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  trade_in_value  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (trade_in_value >= 0),
  trade_in_desc   TEXT NOT NULL DEFAULT '',
  payment_method  TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Negotiation','Finalized','Cancelled')),
  finalized_at    TIMESTAMPTZ,
  -- sale_id is added by ALTER TABLE after dealer.sales exists (forward FK). 
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_deals_vehicle ON dealer.deals (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_deals_customer ON dealer.deals (customer_id);

CREATE TABLE IF NOT EXISTS dealer.sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  ref             TEXT NOT NULL,  -- SALE-0001
  deal_id         UUID NOT NULL REFERENCES dealer.deals(id) ON DELETE RESTRICT,
  vehicle_id      UUID NOT NULL REFERENCES dealer.vehicles(id) ON DELETE RESTRICT,
  customer_id     UUID NOT NULL REFERENCES dealer.customers(id) ON DELETE RESTRICT,
  selling_price   NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
  total_cost      NUMERIC(12,2) NOT NULL CHECK (total_cost >= 0),  -- all-in cost at sale time (snapshot)
  gross_profit    NUMERIC(12,2) NOT NULL,
  net_profit      NUMERIC(12,2) NOT NULL,
  margin_pct      NUMERIC(6,2) NOT NULL,
  date            DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_sales_org_date ON dealer.sales (organization_id, date);
COMMENT ON TABLE dealer.sales IS 'total_cost / gross_profit / net_profit are snapshots taken at finalisation; recomputing later must not rewrite history.';

-- Forward reference from deals.sale_id (deals was created before sales).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'dealer' AND table_name = 'deals' AND column_name = 'sale_id') THEN
    ALTER TABLE dealer.deals ADD COLUMN sale_id UUID REFERENCES dealer.sales(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_deals_sale ON dealer.deals (sale_id);

-- ---------------------------------------------------------------------------
-- Finance: accounts, transactions, journal, receivables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer.accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('Bank','Cash','Petty cash','Floorplan','Credit')),
  currency        TEXT NOT NULL DEFAULT 'USD',
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS dealer.financial_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES dealer.accounts(id) ON DELETE RESTRICT,
  type            TEXT NOT NULL CHECK (type IN ('Deposit','Withdrawal','Vehicle purchase','Vehicle sale','Customer payment','Vendor payment','Transfer','Refund','Debt payment','Expense payment')),
  amount          NUMERIC(12,2) NOT NULL,  -- signed: + in, - out
  category        TEXT NOT NULL DEFAULT '',
  reference       TEXT NOT NULL DEFAULT '',
  date            DATE NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_txns_account_date ON dealer.financial_transactions (account_id, date);
CREATE INDEX IF NOT EXISTS idx_txns_org_date ON dealer.financial_transactions (organization_id, date);

CREATE TABLE IF NOT EXISTS dealer.journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  ref             TEXT NOT NULL,  -- JE-0001
  date            DATE NOT NULL,
  memo            TEXT NOT NULL DEFAULT '',
  reversed_by     UUID REFERENCES dealer.journal_entries(id) ON DELETE SET NULL,
  reversed        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, ref)
);

CREATE TABLE IF NOT EXISTS dealer.journal_entry_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        UUID NOT NULL REFERENCES dealer.journal_entries(id) ON DELETE CASCADE,
  account         TEXT NOT NULL,  -- ledger account name, e.g. 'Vehicle Inventory'
  debit           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK (debit = 0 OR credit = 0)
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON dealer.journal_entry_lines (entry_id);
COMMENT ON TABLE dealer.journal_entry_lines IS 'Every money movement posts a balanced journal entry: sum(debit) = sum(credit) per entry — enforce in application code and with a periodic reconciliation check.';

-- Receivables double as payables: kind Customer = money owed TO the dealer;
-- Vendor/Carrier = money owed BY the dealer. (The app models both in one list.)
CREATE TABLE IF NOT EXISTS dealer.receivables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('Customer','Vendor','Carrier')),
  entity_name     TEXT NOT NULL,
  reference       TEXT NOT NULL DEFAULT '',
  total           NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  paid            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid >= 0),
  due_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Partial','Paid','Overdue')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CHECK (paid <= total)
);
CREATE INDEX IF NOT EXISTS idx_receivables_org_status ON dealer.receivables (organization_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_receivables_org_due ON dealer.receivables (organization_id, due_date);

CREATE TABLE IF NOT EXISTS dealer.payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  receivable_id   UUID NOT NULL REFERENCES dealer.receivables(id) ON DELETE RESTRICT,
  account_id      UUID NOT NULL REFERENCES dealer.accounts(id) ON DELETE RESTRICT,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  date            DATE NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payments_receivable ON dealer.payments (receivable_id, date);
COMMENT ON TABLE dealer.payments IS 'One row per payment against a receivable; record_payment rejects any payment that would make paid > total. The app currently folds this into the transaction + journal write — keep the row for the server implementation.';

-- ---------------------------------------------------------------------------
-- Parts (FIFO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer.parts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,
  name            TEXT NOT NULL,
  manufacturer    TEXT NOT NULL DEFAULT '',
  supplier        TEXT NOT NULL DEFAULT '',
  min_stock       INT NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, sku)
);

CREATE TABLE IF NOT EXISTS dealer.part_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  part_id         UUID NOT NULL REFERENCES dealer.parts(id) ON DELETE RESTRICT,
  qty_received    INT NOT NULL CHECK (qty_received > 0),
  qty_remaining   INT NOT NULL CHECK (qty_remaining >= 0),
  unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  invoice         TEXT NOT NULL DEFAULT '',
  purchase_date   DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CHECK (qty_remaining <= qty_received)
);
CREATE INDEX IF NOT EXISTS idx_batches_part_date ON dealer.part_batches (part_id, purchase_date);
COMMENT ON TABLE dealer.part_batches IS 'FIFO order is purchase_date, then id. Consumption never lets qty_remaining go below 0.';

CREATE TABLE IF NOT EXISTS dealer.part_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  part_id         UUID NOT NULL REFERENCES dealer.parts(id) ON DELETE RESTRICT,
  batch_id        UUID REFERENCES dealer.part_batches(id) ON DELETE SET NULL,
  qty             INT NOT NULL,  -- positive = in, negative = out
  type            TEXT NOT NULL CHECK (type IN ('purchase','consume','return','adjust','sale')),
  unit_cost       NUMERIC(12,2) NOT NULL,
  total_cost      NUMERIC(12,2) NOT NULL,
  vehicle_id      UUID REFERENCES dealer.vehicles(id) ON DELETE SET NULL,
  date            DATE NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_part_date ON dealer.part_movements (part_id, date);
CREATE INDEX IF NOT EXISTS idx_movements_vehicle ON dealer.part_movements (vehicle_id);

CREATE TABLE IF NOT EXISTS dealer.part_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  part_id         UUID NOT NULL REFERENCES dealer.parts(id) ON DELETE RESTRICT,
  vehicle_id      UUID NOT NULL REFERENCES dealer.vehicles(id) ON DELETE RESTRICT,
  qty             INT NOT NULL CHECK (qty > 0),
  fifo_cost       NUMERIC(12,2) NOT NULL CHECK (fifo_cost >= 0),
  date            DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_allocations_vehicle ON dealer.part_allocations (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_allocations_part ON dealer.part_allocations (part_id);

-- One row per batch slice consumed by an allocation (the FIFO paper trail).
CREATE TABLE IF NOT EXISTS dealer.part_allocation_slices (
  allocation_id   UUID NOT NULL REFERENCES dealer.part_allocations(id) ON DELETE CASCADE,
  batch_id        UUID NOT NULL REFERENCES dealer.part_batches(id) ON DELETE RESTRICT,
  qty             INT NOT NULL CHECK (qty > 0),
  unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (allocation_id, batch_id)
);

CREATE TABLE IF NOT EXISTS dealer.purchase_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  ref             TEXT NOT NULL,
  part_id         UUID REFERENCES dealer.parts(id) ON DELETE SET NULL,
  supplier        TEXT NOT NULL DEFAULT '',
  qty             INT NOT NULL CHECK (qty > 0),
  unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  status          TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Ordered','Received','Cancelled')),
  expected_date   DATE,
  received_date   DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (organization_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_org_status ON dealer.purchase_orders (organization_id, status);

-- ---------------------------------------------------------------------------
-- Documents, notifications, audit, AI operations, settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dealer.documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT '',
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('Vehicle','Customer','Expense','Transaction','Deal')),
  entity_id       UUID NOT NULL,
  file_name       TEXT NOT NULL,
  file_size       BIGINT NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  file_type       TEXT NOT NULL DEFAULT '',
  storage_key     TEXT NOT NULL DEFAULT '',  -- object-storage key; empty in the demo build
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by     UUID REFERENCES dealer.users(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ,
  access_role     TEXT NOT NULL DEFAULT 'Manager' CHECK (access_role IN ('Owner','Admin','Manager','Sales','Accountant','Technician','Viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_documents_entity ON dealer.documents (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_org_type ON dealer.documents (organization_id, type);

-- Forward FK from vehicle_documents (its table is defined before documents).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = 'dealer' AND table_name = 'vehicle_documents' AND constraint_name = 'fk_vehicle_documents_document') THEN
    ALTER TABLE dealer.vehicle_documents ADD CONSTRAINT fk_vehicle_documents_document FOREIGN KEY (document_id) REFERENCES dealer.documents(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS dealer.notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES dealer.users(id) ON DELETE CASCADE,  -- NULL = broadcast to the organization
  title           TEXT NOT NULL,
  detail          TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL DEFAULT 'info' CHECK (kind IN ('alert','info','success')),
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  read            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON dealer.notifications (user_id, read, date DESC);

CREATE TABLE IF NOT EXISTS dealer.audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  actor_id        UUID REFERENCES dealer.users(id) ON DELETE SET NULL,
  actor_name      TEXT NOT NULL DEFAULT '',
  action          TEXT NOT NULL,  -- e.g. 'SALE_FINALIZED', 'EXPENSE_RECORDED'
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  summary         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Audit rows are append-only: no updated_at, no deleted_at, no UPDATEs.
);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON dealer.audit_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON dealer.audit_logs (entity_type, entity_id);
COMMENT ON TABLE dealer.audit_logs IS 'Append-only. Never updated or deleted; corrections are new rows.';

CREATE TABLE IF NOT EXISTS dealer.ai_operations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES dealer.users(id) ON DELETE SET NULL,
  raw_command     TEXT NOT NULL,
  parsed_kind     TEXT NOT NULL,  -- 'create_vehicle', 'record_expense', 'query_aged', 'sensitive', 'unknown', ...
  parsed_payload  JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','executed','cancelled','rejected')),
  result_summary  TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_ops_org_created ON dealer.ai_operations (organization_id, created_at DESC);
COMMENT ON TABLE dealer.ai_operations IS 'Record of every assistant command: what was parsed, whether it was confirmed, and what it did. Sensitive commands are stored as rejected, never executed.';

CREATE TABLE IF NOT EXISTS dealer.settings (
  organization_id UUID PRIMARY KEY REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  org_name        TEXT NOT NULL DEFAULT '',
  currency        TEXT NOT NULL DEFAULT 'USD',
  target_hold_days INT NOT NULL DEFAULT 45 CHECK (target_hold_days >= 0),
  overhead_per_vehicle NUMERIC(12,2) NOT NULL DEFAULT 150.00 CHECK (overhead_per_vehicle >= 0),
  theme           TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE dealer.settings IS 'One row per organization. Mirrors AppState.settings in the demo store.';

-- ---------------------------------------------------------------------------
-- updated_at triggers (all tables with updated_at)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','users','roles','organization_members','vehicles',
    'vehicle_purchases','transportation_orders','expenses',
    'reconditioning_jobs','vendors','customers','leads','deals','sales',
    'accounts','receivables','parts','part_batches','part_allocations',
    'purchase_orders','ai_operations'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON dealer.%I', 'trg_' || t || '_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON dealer.%I FOR EACH ROW EXECUTE FUNCTION dealer.set_updated_at()',
      t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Seed: built-in expense categories (organization_id NULL = shared)
-- ---------------------------------------------------------------------------
INSERT INTO dealer.permissions (code, description) VALUES
  ('vehicle.create','Register a vehicle'), ('vehicle.update','Change vehicle status/details'),
  ('purchase.create','Record a vehicle purchase'), ('expense.create','Record an expense'),
  ('expense.pay','Mark an expense paid (moves money)'), ('part.allocate','Allocate parts (FIFO)'),
  ('customer.create','Create a customer'), ('lead.create','Create a lead'),
  ('deal.create','Create a deal draft'), ('sale.finalize','Finalize a sale (moves money)'),
  ('payment.record','Record a payment against a receivable'),
  ('finance.read','Read accounts, transactions and journal'),
  ('mcp.read','Call MCP READ tools'), ('mcp.write','Call MCP WRITE tools')
ON CONFLICT (code) DO NOTHING;

INSERT INTO dealer.expense_categories (organization_id, name, kind_default) VALUES
  (NULL,'Mechanical repairs','Direct'), (NULL,'Bodywork','Direct'), (NULL,'Paint','Direct'),
  (NULL,'Detailing','Direct'), (NULL,'Tires','Direct'), (NULL,'Battery','Direct'),
  (NULL,'Glass','Direct'), (NULL,'Inspection','Direct'), (NULL,'Parts','Direct'),
  (NULL,'Labor','Direct'), (NULL,'Transportation','Direct'), (NULL,'Auction fees','Direct'),
  (NULL,'Advertising','Overhead'), (NULL,'Rent','Overhead'), (NULL,'Utilities','Overhead'),
  (NULL,'Insurance','Overhead'), (NULL,'Payroll','Overhead'), (NULL,'Other overhead','Overhead')
ON CONFLICT DO NOTHING;
