// Costing helpers: all-in vehicle cost and org settings, computed from DB
// rows with the same formula as the frontend engine (vehicleAllInCost).
import type { PoolClient } from 'pg';
import { money, num } from './money';
import { vehicleAllInCost as pureAllInCost } from './fifo';

export interface OrgSettings {
  orgName: string;
  currency: string;
  targetHoldDays: number;
  overheadPerVehicle: number;
  theme: string;
}

/** Load the org's settings row, creating it from the organization row if missing. */
export async function getOrgSettings(client: PoolClient, orgId: string): Promise<OrgSettings> {
  const org = await client.query(
    `SELECT name, currency, target_hold_days, overhead_per_vehicle
       FROM dealer.organizations WHERE id = $1`,
    [orgId],
  );
  const orgRow = org.rows[0] ?? {};
  await client.query(
    `INSERT INTO dealer.settings (organization_id, org_name, currency, target_hold_days, overhead_per_vehicle, theme)
     VALUES ($1, $2, $3, $4, $5, 'light')
     ON CONFLICT (organization_id) DO NOTHING`,
    [
      orgId,
      (orgRow.name as string) ?? '',
      (orgRow.currency as string) ?? 'USD',
      Number(orgRow.target_hold_days ?? 45),
      num(orgRow.overhead_per_vehicle ?? 150),
    ],
  );
  const res = await client.query(`SELECT * FROM dealer.settings WHERE organization_id = $1`, [orgId]);
  const row = res.rows[0];
  return {
    orgName: (row.org_name as string) ?? '',
    currency: (row.currency as string) ?? 'USD',
    targetHoldDays: Number(row.target_hold_days ?? 45),
    overheadPerVehicle: num(row.overhead_per_vehicle),
    theme: (row.theme as string) ?? 'light',
  };
}

/** Direct (kind='Direct') expenses linked to a vehicle. */
export async function vehicleDirectExpenses(
  client: PoolClient,
  orgId: string,
  vehicleId: string,
): Promise<number> {
  const res = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM dealer.expenses
      WHERE organization_id = $1 AND vehicle_id = $2 AND kind = 'Direct' AND deleted_at IS NULL`,
    [orgId, vehicleId],
  );
  return money(num(res.rows[0]?.total));
}

/** FIFO parts cost allocated to a vehicle (sum of allocation fifo_cost). */
export async function vehiclePartsCost(
  client: PoolClient,
  orgId: string,
  vehicleId: string,
): Promise<number> {
  const res = await client.query(
    `SELECT COALESCE(SUM(fifo_cost), 0) AS total FROM dealer.part_allocations
      WHERE organization_id = $1 AND vehicle_id = $2 AND deleted_at IS NULL`,
    [orgId, vehicleId],
  );
  return money(num(res.rows[0]?.total));
}

export interface VehicleCostBasis {
  purchasePrice: number;
  auctionFees: number;
  transportCost: number;
}

/** All-in cost from DB rows: purchase + auction fees + transport + direct + parts + overhead. */
export async function vehicleAllInCostDb(
  client: PoolClient,
  orgId: string,
  vehicleId: string,
  basis: VehicleCostBasis,
  overheadPerVehicle: number,
): Promise<number> {
  const [direct, parts] = await Promise.all([
    vehicleDirectExpenses(client, orgId, vehicleId),
    vehiclePartsCost(client, orgId, vehicleId),
  ]);
  return pureAllInCost(basis, direct, parts, overheadPerVehicle);
}
