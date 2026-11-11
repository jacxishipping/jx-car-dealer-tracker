// Pure business engine — no React, no I/O. Fully unit-testable.
// Every money figure in the app must come through these functions.

import type {
  AppState, Deal, Expense, PartAllocation, PartBatch, Vehicle,
} from './types'
import { money } from './types'

export interface FifoSlice { batchId: string; qty: number; unitPrice: number }

/**
 * Consume `qty` units of a part across batches, oldest purchase first (FIFO).
 * Returns the slices consumed and the total FIFO cost.
 * Example from the spec: 10 @ $50 + 10 @ $60, consume 12 → $500 + $120 = $620.
 * Throws on insufficient stock or non-positive qty. Does NOT mutate.
 */
export function fifoConsume(
  batches: PartBatch[],
  partId: string,
  qty: number,
): { slices: FifoSlice[]; totalCost: number } {
  if (qty <= 0) throw new Error('Quantity to consume must be positive')
  const open = batches
    .filter((b) => b.partId === partId && b.qtyRemaining > 0)
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id))
  const available = open.reduce((s, b) => s + b.qtyRemaining, 0)
  if (available < qty) {
    throw new Error(`Insufficient stock: ${available} available, ${qty} requested`)
  }
  const slices: FifoSlice[] = []
  let remaining = qty
  for (const b of open) {
    if (remaining === 0) break
    const take = Math.min(b.qtyRemaining, remaining)
    slices.push({ batchId: b.id, qty: take, unitPrice: b.unitPrice })
    remaining -= take
  }
  const totalCost = money(slices.reduce((s, x) => s + x.qty * x.unitPrice, 0))
  return { slices, totalCost }
}

/** Apply FIFO slices to batches, returning new batch list (immutable). */
export function applyFifoSlices(batches: PartBatch[], slices: FifoSlice[]): PartBatch[] {
  return batches.map((b) => {
    const s = slices.find((x) => x.batchId === b.id)
    return s ? { ...b, qtyRemaining: b.qtyRemaining - s.qty } : b
  })
}

export function partStock(batches: PartBatch[], partId: string): number {
  return batches.filter((b) => b.partId === partId).reduce((s, b) => s + b.qtyRemaining, 0)
}

export function partValue(batches: PartBatch[], partId: string): number {
  return money(batches.filter((b) => b.partId === partId)
    .reduce((s, b) => s + b.qtyRemaining * b.unitPrice, 0))
}

/** Direct vehicle expenses (recon + repairs + parts etc. linked to the vehicle). */
export function vehicleDirectExpenses(expenses: Expense[], vehicleId: string): number {
  return money(expenses
    .filter((e) => e.vehicleId === vehicleId && e.kind === 'Direct')
    .reduce((s, e) => s + e.amount, 0))
}

export function vehiclePartsCost(allocations: PartAllocation[], vehicleId: string): number {
  return money(allocations.filter((a) => a.vehicleId === vehicleId)
    .reduce((s, a) => s + a.fifoCost, 0))
}

/**
 * All-in vehicle cost:
 * purchase + auction fees + transport + direct expenses + FIFO parts + allocated overhead.
 */
export function vehicleAllInCost(
  v: Vehicle,
  expenses: Expense[],
  allocations: PartAllocation[],
  overheadPerVehicle: number,
): number {
  return money(
    v.purchasePrice + v.auctionFees + v.transportCost
    + vehicleDirectExpenses(expenses, v.id)
    + vehiclePartsCost(allocations, v.id)
    + overheadPerVehicle,
  )
}

export interface DealProfit {
  totalCost: number
  grossProfit: number
  sellingExpenses: number
  netProfit: number
  marginPct: number
  roiPct: number
  breakEven: number
}

/** Deal profitability: selling price − total cost − selling expenses = net profit. */
export function dealProfit(
  deal: Pick<Deal, 'sellingPrice' | 'discount' | 'taxes' | 'fees'>,
  totalCost: number,
): DealProfit {
  const netSelling = money(deal.sellingPrice - deal.discount)
  const sellingExpenses = money(deal.taxes + deal.fees)
  const grossProfit = money(netSelling - totalCost)
  const netProfit = money(grossProfit - sellingExpenses)
  return {
    totalCost: money(totalCost),
    grossProfit,
    sellingExpenses,
    netProfit,
    marginPct: netSelling > 0 ? money((netProfit / netSelling) * 100) : 0,
    roiPct: totalCost > 0 ? money((netProfit / totalCost) * 100) : 0,
    breakEven: money(totalCost + sellingExpenses),
  }
}

export function daysInStock(v: Vehicle, now = new Date()): number {
  const d = Math.floor((now.getTime() - new Date(v.purchaseDate).getTime()) / 86400000)
  return Math.max(0, d)
}

export function accountBalance(state: AppState, accountId: string): number {
  const acc = state.accounts.find((a) => a.id === accountId)
  if (!acc) return 0
  return money(acc.openingBalance
    + state.transactions.filter((t) => t.accountId === accountId)
      .reduce((s, t) => s + t.amount, 0))
}

export function totalCash(state: AppState): number {
  return money(state.accounts.reduce((s, a) => s + accountBalance(state, a.id), 0))
}

export interface DashboardKpis {
  inventoryValue: number
  stockCount: number
  acquisitionCost: number
  salesRevenue: number
  grossProfit: number
  netProfit: number
  marginPct: number
  totalExpenses: number
  cash: number
  receivables: number
  payables: number
  inTransit: number
  inRecon: number
  available: number
  reserved: number
  sold: number
}

/** All dashboard figures derive from state — nothing is hardcoded. */
export function dashboardKpis(state: AppState): DashboardKpis {
  const inStock = state.vehicles.filter((v) => v.status !== 'Sold' && v.status !== 'Wholesale' && v.status !== 'Returned')
  const inventoryValue = money(inStock.reduce((s, v) =>
    s + vehicleAllInCost(v, state.expenses, state.partAllocations, state.settings.overheadPerVehicle), 0))
  const acquisitionCost = money(state.vehicles.reduce((s, v) => s + v.purchasePrice + v.auctionFees, 0))
  const salesRevenue = money(state.sales.reduce((s, x) => s + x.sellingPrice, 0))
  const grossProfit = money(state.sales.reduce((s, x) => s + x.grossProfit, 0))
  const overhead = money(state.expenses.filter((e) => e.kind === 'Overhead').reduce((s, e) => s + e.amount, 0))
  const netProfit = money(grossProfit - overhead)
  const totalExpenses = money(state.expenses.reduce((s, e) => s + e.amount, 0))
  const receivables = money(state.receivables.filter((r) => r.kind === 'Customer').reduce((s, r) => s + (r.total - r.paid), 0))
  const payables = money(state.receivables.filter((r) => r.kind !== 'Customer').reduce((s, r) => s + (r.total - r.paid), 0))
  const count = (st: Vehicle['status']) => state.vehicles.filter((v) => v.status === st).length
  return {
    inventoryValue,
    stockCount: inStock.length,
    acquisitionCost,
    salesRevenue,
    grossProfit,
    netProfit,
    marginPct: salesRevenue > 0 ? money((netProfit / salesRevenue) * 100) : 0,
    totalExpenses,
    cash: totalCash(state),
    receivables,
    payables,
    inTransit: count('In transit'),
    inRecon: count('In reconditioning'),
    available: count('Available'),
    reserved: count('Reserved'),
    sold: count('Sold'),
  }
}

/** Monthly revenue / profit series for charts (last `months` months incl. current). */
export function monthlySeries(state: AppState, months = 6): { label: string; revenue: number; profit: number }[] {
  const out: { label: string; revenue: number; profit: number }[] = []
  const now = new Date()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleString('en-US', { month: 'short' })
    const revenue = money(state.sales.filter((s) => s.date.startsWith(key)).reduce((s, x) => s + x.sellingPrice, 0))
    const profit = money(state.sales.filter((s) => s.date.startsWith(key)).reduce((s, x) => s + x.netProfit, 0))
    out.push({ label, revenue, profit })
  }
  return out
}

/** Simple labelled forecast from recent monthly averages — always labelled FORECAST, never actuals. */
export function forecast(state: AppState): {
  nextRevenue: number; nextProfit: number; marginPct: number;
  conservative: number; baseline: number; optimistic: number;
} {
  const series = monthlySeries(state, 6)
  const avgRevenue = series.reduce((s, m) => s + m.revenue, 0) / 6
  const avgProfit = series.reduce((s, m) => s + m.profit, 0) / 6
  const trend = series.length > 1 ? (series[series.length - 1].revenue - series[0].revenue) / 5 : 0
  const baseline = money(Math.max(0, avgRevenue + trend))
  return {
    nextRevenue: baseline,
    nextProfit: money(Math.max(0, avgProfit + trend * 0.2)),
    marginPct: baseline > 0 ? money((money(Math.max(0, avgProfit + trend * 0.2)) / baseline) * 100) : 0,
    conservative: money(baseline * 0.85),
    baseline,
    optimistic: money(baseline * 1.18),
  }
}
