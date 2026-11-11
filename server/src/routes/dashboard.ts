// GET /api/dashboard — KPIs (same fields as frontend dashboardKpis) +
// monthlySeries (6 months) + forecast, always labelled FORECAST.
// getDashboardData() is exported for the MCP get_inventory_summary tool.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { query } from '../db';
import { authenticate, requireOrgId } from '../middleware/auth';
import { money, num } from '../lib/money';
import { getOrgSettings } from '../lib/costing';
import { withTransaction } from '../db';

export interface DashboardKpis {
  inventoryValue: number;
  stockCount: number;
  acquisitionCost: number;
  salesRevenue: number;
  grossProfit: number;
  netProfit: number;
  marginPct: number;
  totalExpenses: number;
  cash: number;
  receivables: number;
  payables: number;
  inTransit: number;
  inRecon: number;
  available: number;
  reserved: number;
  sold: number;
}

export interface MonthlyPoint {
  label: string;
  revenue: number;
  profit: number;
}

export interface DashboardData {
  kpis: DashboardKpis;
  monthlySeries: MonthlyPoint[];
  forecast: {
    nextRevenue: number;
    nextProfit: number;
    marginPct: number;
    conservative: number;
    baseline: number;
    optimistic: number;
    label: 'FORECAST';
  };
}

export async function getDashboardData(orgId: string): Promise<DashboardData> {
  const settings = await withTransaction(async (client) => getOrgSettings(client, orgId));
  const overhead = settings.overheadPerVehicle;

  const [vehiclesRes, salesRes, expensesRes, accountsRes, txnsRes, receivablesRes] =
    await Promise.all([
      query(
        `SELECT id, status, purchase_price, auction_fees, transport_cost
           FROM dealer.vehicles WHERE organization_id = $1 AND deleted_at IS NULL`,
        [orgId],
      ),
      query(
        `SELECT selling_price, gross_profit, net_profit, date FROM dealer.sales
          WHERE organization_id = $1 AND deleted_at IS NULL`,
        [orgId],
      ),
      query(
        `SELECT amount, kind, vehicle_id FROM dealer.expenses
          WHERE organization_id = $1 AND deleted_at IS NULL`,
        [orgId],
      ),
      query(
        `SELECT opening_balance FROM dealer.accounts WHERE organization_id = $1 AND deleted_at IS NULL`,
        [orgId],
      ),
      query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM dealer.financial_transactions
          WHERE organization_id = $1 AND deleted_at IS NULL`,
        [orgId],
      ),
      query(
        `SELECT kind, total, paid FROM dealer.receivables WHERE organization_id = $1 AND deleted_at IS NULL`,
        [orgId],
      ),
    ]);

  // Per-vehicle direct expenses + FIFO parts, in one query each.
  const [directRes, partsRes] = await Promise.all([
    query(
      `SELECT vehicle_id, COALESCE(SUM(amount), 0) AS total FROM dealer.expenses
        WHERE organization_id = $1 AND kind = 'Direct' AND vehicle_id IS NOT NULL AND deleted_at IS NULL
        GROUP BY vehicle_id`,
      [orgId],
    ),
    query(
      `SELECT vehicle_id, COALESCE(SUM(fifo_cost), 0) AS total FROM dealer.part_allocations
        WHERE organization_id = $1 AND deleted_at IS NULL GROUP BY vehicle_id`,
      [orgId],
    ),
  ]);
  const directByVehicle = new Map<string, number>(
    directRes.rows.map((r) => [r.vehicle_id as string, num(r.total)]),
  );
  const partsByVehicle = new Map<string, number>(
    partsRes.rows.map((r) => [r.vehicle_id as string, num(r.total)]),
  );

  const vehicles = vehiclesRes.rows;
  const inStock = vehicles.filter(
    (v) => v.status !== 'Sold' && v.status !== 'Wholesale' && v.status !== 'Returned',
  );
  const allIn = (v: (typeof vehicles)[number]): number =>
    money(
      num(v.purchase_price) +
        num(v.auction_fees) +
        num(v.transport_cost) +
        (directByVehicle.get(v.id as string) ?? 0) +
        (partsByVehicle.get(v.id as string) ?? 0) +
        overhead,
    );
  const inventoryValue = money(inStock.reduce((s, v) => s + allIn(v), 0));
  const acquisitionCost = money(
    vehicles.reduce((s, v) => s + num(v.purchase_price) + num(v.auction_fees), 0),
  );

  const sales = salesRes.rows;
  const salesRevenue = money(sales.reduce((s, x) => s + num(x.selling_price), 0));
  const grossProfit = money(sales.reduce((s, x) => s + num(x.gross_profit), 0));
  const overheadTotal = money(
    expensesRes.rows.filter((e) => e.kind === 'Overhead').reduce((s, e) => s + num(e.amount), 0),
  );
  const netProfit = money(grossProfit - overheadTotal);
  const totalExpenses = money(expensesRes.rows.reduce((s, e) => s + num(e.amount), 0));
  const cash = money(
    accountsRes.rows.reduce((s, a) => s + num(a.opening_balance), 0) +
      num(txnsRes.rows[0]?.total),
  );
  const receivables = money(
    receivablesRes.rows
      .filter((r) => r.kind === 'Customer')
      .reduce((s, r) => s + (num(r.total) - num(r.paid)), 0),
  );
  const payables = money(
    receivablesRes.rows
      .filter((r) => r.kind !== 'Customer')
      .reduce((s, r) => s + (num(r.total) - num(r.paid)), 0),
  );
  const count = (status: string): number => vehicles.filter((v) => v.status === status).length;

  const kpis: DashboardKpis = {
    inventoryValue,
    stockCount: inStock.length,
    acquisitionCost,
    salesRevenue,
    grossProfit,
    netProfit,
    marginPct: salesRevenue > 0 ? money((netProfit / salesRevenue) * 100) : 0,
    totalExpenses,
    cash,
    receivables,
    payables,
    inTransit: count('In transit'),
    inRecon: count('In reconditioning'),
    available: count('Available'),
    reserved: count('Reserved'),
    sold: count('Sold'),
  };

  // Monthly series: last 6 months including the current one.
  const monthlySeries: MonthlyPoint[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('en-US', { month: 'short' });
    const monthSales = sales.filter((s) => {
      const sd = s.date instanceof Date ? (s.date as Date).toISOString().slice(0, 7) : String(s.date).slice(0, 7);
      return sd === key;
    });
    monthlySeries.push({
      label,
      revenue: money(monthSales.reduce((s, x) => s + num(x.selling_price), 0)),
      profit: money(monthSales.reduce((s, x) => s + num(x.net_profit), 0)),
    });
  }

  // Forecast from recent monthly averages — labelled FORECAST, never actuals.
  const avgRevenue = monthlySeries.reduce((s, m) => s + m.revenue, 0) / 6;
  const avgProfit = monthlySeries.reduce((s, m) => s + m.profit, 0) / 6;
  const trend = (monthlySeries[5].revenue - monthlySeries[0].revenue) / 5;
  const baseline = money(Math.max(0, avgRevenue + trend));
  const nextProfit = money(Math.max(0, avgProfit + trend * 0.2));
  const forecast = {
    nextRevenue: baseline,
    nextProfit,
    marginPct: baseline > 0 ? money((nextProfit / baseline) * 100) : 0,
    conservative: money(baseline * 0.85),
    baseline,
    optimistic: money(baseline * 1.18),
    label: 'FORECAST' as const,
  };

  return { kpis, monthlySeries, forecast };
}

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = requireOrgId(req);
    res.json(await getDashboardData(orgId));
  } catch (err) {
    next(err);
  }
});
