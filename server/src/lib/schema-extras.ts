// Supplementary DDL that the shipped schema (docs/schema.sql) does not cover:
// the `offers` table. The frontend model (src/store/types.ts) has offers and
// the API contract requires POST /api/offers, but docs/schema.sql ships 39
// tables and no offers table, and that file must not be modified. migrate.ts
// runs this statement right after the schema file, inside the same
// transaction, so a migrated database always has the table.
export const OFFERS_DDL = `
CREATE TABLE IF NOT EXISTS dealer.offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES dealer.organizations(id) ON DELETE CASCADE,
  vehicle_id      UUID NOT NULL REFERENCES dealer.vehicles(id) ON DELETE RESTRICT,
  customer_id     UUID NOT NULL REFERENCES dealer.customers(id) ON DELETE RESTRICT,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  date            DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Accepted','Declined','Expired')),
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_offers_vehicle ON dealer.offers (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_offers_customer ON dealer.offers (customer_id);

INSERT INTO dealer.permissions (code, description) VALUES
  ('finance.write', 'Create financial accounts and transfers'),
  ('team.manage', 'Invite and activate/deactivate team members'),
  ('settings.write', 'Update organization settings'),
  ('ai.execute', 'Create and confirm AI operations')
ON CONFLICT (code) DO NOTHING;
`;
