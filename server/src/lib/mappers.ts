// snake_case DB row → camelCase API object. Field names/casing match
// src/store/types.ts (frontend AppState) exactly. pg returns NUMERIC as a
// string and DATE/TIMESTAMPTZ as Date objects; money fields become numbers,
// date-only columns become 'YYYY-MM-DD', timestamps become full ISO strings.
import { num } from './money';

type Row = Record<string, unknown>;

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

interface MapOpts {
  money?: string[];
  dateOnly?: string[];
  drop?: string[];
}

export function mapRow(row: Row, opts: MapOpts = {}): Record<string, unknown> {
  const moneySet = new Set(opts.money ?? []);
  const dateOnlySet = new Set(opts.dateOnly ?? []);
  const dropSet = new Set(opts.drop ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (dropSet.has(key)) continue;
    const ck = toCamel(key);
    if (value instanceof Date) {
      out[ck] = dateOnlySet.has(key) ? value.toISOString().slice(0, 10) : value.toISOString();
    } else if (moneySet.has(key)) {
      out[ck] = num(value);
    } else {
      out[ck] = value;
    }
  }
  return out;
}

// --- Vehicles ---------------------------------------------------------------
export function mapVehicle(row: Row): Record<string, unknown> {
  const v = mapRow(row, {
    money: ['purchase_price', 'auction_fees', 'transport_cost', 'asking_price', 'min_price'],
    dateOnly: ['purchase_date'],
  });
  if (!('photos' in v)) v.photos = [];
  return v;
}

// --- Purchases --------------------------------------------------------------
export function mapPurchase(row: Row): Record<string, unknown> {
  return mapRow(row, {
    money: ['vehicle_price', 'buyer_fees', 'auction_fees', 'taxes', 'transport_estimate'],
    dateOnly: ['purchase_date'],
  });
}

// --- Transport --------------------------------------------------------------
export function mapTransport(row: Row): Record<string, unknown> {
  const t = mapRow(row, {
    money: ['price'],
    dateOnly: ['pickup_date', 'expected_delivery', 'actual_delivery'],
  });
  if (!('photos' in t)) t.photos = [];
  return t;
}

// --- Expenses ---------------------------------------------------------------
export function mapExpense(row: Row): Record<string, unknown> {
  const e = mapRow(row, { money: ['amount'], dateOnly: ['date'], drop: ['category_id', 'vendor_id'] });
  e.vendor = (row.vendor_name as string) ?? '';
  // created_by is a user id; when the query joins users, created_by_name wins.
  e.createdBy = (row.created_by_name as string) ?? (row.created_by as string) ?? '';
  return e;
}

// --- Reconditioning ---------------------------------------------------------
export function mapRecon(row: Row): Record<string, unknown> {
  const r = mapRow(row, {
    money: ['estimated_cost', 'actual_cost'],
    dateOnly: ['started_at', 'completed_at'],
    drop: ['category_id'],
  });
  r.category = (row.category_name as string) ?? '';
  return r;
}

// --- Parts ------------------------------------------------------------------
export function mapPart(row: Row): Record<string, unknown> {
  return mapRow(row);
}

export function mapPartBatch(row: Row): Record<string, unknown> {
  return mapRow(row, { money: ['unit_price'], dateOnly: ['purchase_date'] });
}

export function mapPartMovement(row: Row): Record<string, unknown> {
  return mapRow(row, { money: ['unit_cost', 'total_cost'], dateOnly: ['date'] });
}

export function mapPartAllocation(row: Row): Record<string, unknown> {
  const a = mapRow(row, { money: ['fifo_cost'], dateOnly: ['date'] });
  if (!('batches' in a)) a.batches = [];
  return a;
}

// --- CRM --------------------------------------------------------------------
export function mapCustomer(row: Row): Record<string, unknown> {
  const c = mapRow(row, { money: ['budget'] });
  if (!('interestedVehicleIds' in c)) c.interestedVehicleIds = [];
  return c;
}

export function mapLead(row: Row): Record<string, unknown> {
  return mapRow(row, { dateOnly: ['follow_up_date'] });
}

export function mapInteraction(row: Row): Record<string, unknown> {
  return mapRow(row, { dateOnly: ['date'] });
}

export function mapOffer(row: Row): Record<string, unknown> {
  return mapRow(row, { money: ['amount'], dateOnly: ['date'] });
}

// --- Deals / sales ----------------------------------------------------------
export function mapDeal(row: Row): Record<string, unknown> {
  const d = mapRow(row, {
    money: ['selling_price', 'discount', 'taxes', 'fees', 'deposit', 'trade_in_value'],
    drop: ['sale_id'],
  });
  d.saleRef = (row.sale_ref as string) ?? null;
  return d;
}

export function mapSale(row: Row): Record<string, unknown> {
  return mapRow(row, {
    money: ['selling_price', 'total_cost', 'gross_profit', 'net_profit', 'margin_pct'],
    dateOnly: ['date'],
  });
}

// --- Finance ----------------------------------------------------------------
export function mapAccount(row: Row): Record<string, unknown> {
  return mapRow(row, { money: ['opening_balance'] });
}

export function mapTransaction(row: Row): Record<string, unknown> {
  return mapRow(row, { money: ['amount'], dateOnly: ['date'] });
}

export function mapJournal(row: Row, lines: Array<Record<string, unknown>> = []): Record<string, unknown> {
  const j = mapRow(row, { dateOnly: ['date'], drop: ['reversed_by'] });
  j.lines = lines.map((l) => mapRow(l, { money: ['debit', 'credit'], drop: ['entry_id'] }));
  j.reversedBy = (row.reversed_by as string) ?? null;
  return j;
}

export function mapReceivable(row: Row): Record<string, unknown> {
  return mapRow(row, { money: ['total', 'paid'], dateOnly: ['due_date'] });
}

// --- Documents / team / audit / notifications / settings --------------------
export function mapDocument(row: Row): Record<string, unknown> {
  const d = mapRow(row, { drop: ['storage_key'] });
  d.uploadedBy = (row.uploaded_by_name as string) ?? (row.uploaded_by as string) ?? '';
  return d;
}

export function mapTeamMember(row: Row): Record<string, unknown> {
  return {
    id: row.id as string,
    name: (row.display_name as string) ?? '',
    email: (row.email as string) ?? '',
    role: (row.role_name as string) ?? '',
    active: (row.active as boolean) ?? true,
  };
}

export function mapAudit(row: Row): Record<string, unknown> {
  const a = mapRow(row, { drop: ['organization_id', 'actor_id', 'actor_name'] });
  a.at = row.created_at instanceof Date ? (row.created_at as Date).toISOString() : (row.created_at as string);
  a.actor = (row.actor_name as string) ?? '';
  return a;
}

export function mapNotification(row: Row): Record<string, unknown> {
  return mapRow(row, { dateOnly: ['date'] });
}

export function mapSettings(row: Row): Record<string, unknown> {
  return {
    orgName: (row.org_name as string) ?? '',
    currency: (row.currency as string) ?? 'USD',
    targetHoldDays: Number(row.target_hold_days ?? 45),
    overheadPerVehicle: num(row.overhead_per_vehicle),
    theme: (row.theme as string) ?? 'light',
  };
}
