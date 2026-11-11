// Vehicle helpers shared by the CRUD routes, the purchase flow, the AI
// assistant and the MCP tools.
import type { PoolClient } from 'pg';
import { ApiError } from './errors';
import { nextStockNumber } from './refs';
import { money, num } from './money';

export interface VehicleInput {
  stockNumber?: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  extColor?: string;
  intColor?: string;
  mileage?: number;
  transmission?: string;
  engine?: string;
  fuel?: string;
  drivetrain?: string;
  bodyType?: string;
  condition?: string;
  titleStatus?: string;
  status?: string;
  purchaseDate: string;
  purchaseSource?: string;
  purchasePrice?: number;
  auctionFees?: number;
  transportCost?: number;
  askingPrice?: number;
  minPrice?: number;
  notes?: string;
}

const VEHICLE_COLUMNS: Record<string, string> = {
  stockNumber: 'stock_number',
  vin: 'vin',
  year: 'year',
  make: 'make',
  model: 'model',
  trim: 'trim',
  extColor: 'ext_color',
  intColor: 'int_color',
  mileage: 'mileage',
  transmission: 'transmission',
  engine: 'engine',
  fuel: 'fuel',
  drivetrain: 'drivetrain',
  bodyType: 'body_type',
  condition: 'condition',
  titleStatus: 'title_status',
  status: 'status',
  purchaseDate: 'purchase_date',
  purchaseSource: 'purchase_source',
  purchasePrice: 'purchase_price',
  auctionFees: 'auction_fees',
  transportCost: 'transport_cost',
  askingPrice: 'asking_price',
  minPrice: 'min_price',
  notes: 'notes',
};

/** Build the INSERT column/value lists for a vehicle row (org id excluded). */
export function vehicleColumns(input: VehicleInput): { columns: string[]; values: unknown[] } {
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const [bodyKey, column] of Object.entries(VEHICLE_COLUMNS)) {
    const v = (input as unknown as Record<string, unknown>)[bodyKey];
    if (v !== undefined) {
      columns.push(column);
      values.push(v);
    }
  }
  return { columns, values };
}

/** Live-row VIN duplicate check for the org (soft-deleted rows free the VIN). */
export async function assertVinAvailable(
  client: PoolClient,
  orgId: string,
  vin: string,
  excludeId?: string,
): Promise<void> {
  const res = await client.query(
    `SELECT id, stock_number FROM dealer.vehicles
      WHERE organization_id = $1 AND upper(vin) = upper($2) AND deleted_at IS NULL
        AND ($3::uuid IS NULL OR id <> $3)`,
    [orgId, vin, excludeId ?? null],
  );
  if (res.rows.length > 0) {
    throw new ApiError(
      409,
      `A vehicle with VIN ${vin} already exists (${res.rows[0].stock_number}).`,
      'DUPLICATE_VIN',
    );
  }
}

/** Insert a vehicle row (VIN check + stock-number generation included). */
export async function insertVehicleTx(
  client: PoolClient,
  orgId: string,
  input: VehicleInput,
): Promise<Record<string, unknown>> {
  await assertVinAvailable(client, orgId, input.vin);
  const stockNumber = input.stockNumber?.trim() || (await nextStockNumber(client, orgId));
  const dupStock = await client.query(
    `SELECT id FROM dealer.vehicles
      WHERE organization_id = $1 AND stock_number = $2 AND deleted_at IS NULL`,
    [orgId, stockNumber],
  );
  if (dupStock.rows.length > 0) {
    throw new ApiError(409, `A vehicle with stock number ${stockNumber} already exists.`, 'DUPLICATE_STOCK');
  }
  const { columns, values } = vehicleColumns({ ...input, stockNumber });
  const placeholders = values.map((_, i) => `$${i + 2}`).join(', ');
  const res = await client.query(
    `INSERT INTO dealer.vehicles (organization_id, ${columns.join(', ')})
     VALUES ($1, ${placeholders}) RETURNING *`,
    [orgId, ...values],
  );
  return res.rows[0] as Record<string, unknown>;
}

export interface VehicleRowLike {
  id: string;
  stockNumber: string;
  vin: string;
  make: string;
  model: string;
  status: string;
  purchasePrice: number;
  auctionFees: number;
  transportCost: number;
}

/**
 * Resolve a vehicle from a free-text reference, mirroring the frontend
 * AiAssistant resolveVehicle(): stock number → VIN → make → "make model" → model.
 */
export function resolveVehicleRef(vehicles: VehicleRowLike[], ref: string): VehicleRowLike | undefined {
  const r = ref.trim().toLowerCase();
  if (!r) return undefined;
  return (
    vehicles.find((v) => v.stockNumber.toLowerCase() === r) ??
    vehicles.find((v) => v.vin.toLowerCase() === r) ??
    vehicles.find((v) => v.make.toLowerCase() === r && v.status !== 'Sold') ??
    vehicles.find((v) => v.make.toLowerCase() === r) ??
    vehicles.find((v) => `${v.make} ${v.model}`.toLowerCase().includes(r)) ??
    vehicles.find((v) => v.model.toLowerCase() === r)
  );
}

export async function loadOrgVehicles(client: PoolClient, orgId: string): Promise<VehicleRowLike[]> {
  const res = await client.query(
    `SELECT id, stock_number, vin, make, model, status,
            purchase_price, auction_fees, transport_cost
       FROM dealer.vehicles WHERE organization_id = $1 AND deleted_at IS NULL`,
    [orgId],
  );
  return res.rows.map((r) => ({
    id: r.id as string,
    stockNumber: r.stock_number as string,
    vin: r.vin as string,
    make: r.make as string,
    model: r.model as string,
    status: r.status as string,
    purchasePrice: num(r.purchase_price),
    auctionFees: num(r.auction_fees),
    transportCost: money(num(r.transport_cost)),
  }));
}
