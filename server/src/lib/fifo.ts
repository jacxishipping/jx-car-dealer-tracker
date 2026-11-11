// Pure business engine — port of src/store/engine.ts (frontend). No I/O,
// no database access, fully unit-testable. The server is authoritative for
// these figures; the frontend mirrors them.

import { money } from './money';

export interface FifoBatchInput {
  id: string;
  partId: string;
  qtyRemaining: number;
  unitPrice: number;
  /** ISO date string (YYYY-MM-DD). FIFO order is purchaseDate, then id. */
  purchaseDate: string;
}

export interface FifoSlice {
  batchId: string;
  qty: number;
  unitPrice: number;
}

/**
 * Consume `qty` units of a part across batches, oldest purchase first (FIFO).
 * Returns the slices consumed and the total FIFO cost.
 * Example from the spec: 10 @ $50 + 10 @ $60, consume 12 → $500 + $120 = $620.
 * Throws on insufficient stock or non-positive qty. Does NOT mutate.
 */
export function fifoConsume(
  batches: FifoBatchInput[],
  partId: string,
  qty: number,
): { slices: FifoSlice[]; totalCost: number } {
  if (qty <= 0) throw new Error('Quantity to consume must be positive');
  const open = batches
    .filter((b) => b.partId === partId && b.qtyRemaining > 0)
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));
  const available = open.reduce((s, b) => s + b.qtyRemaining, 0);
  if (available < qty) {
    throw new Error(`Insufficient stock: ${available} available, ${qty} requested`);
  }
  const slices: FifoSlice[] = [];
  let remaining = qty;
  for (const b of open) {
    if (remaining === 0) break;
    const take = Math.min(b.qtyRemaining, remaining);
    slices.push({ batchId: b.id, qty: take, unitPrice: b.unitPrice });
    remaining -= take;
  }
  const totalCost = money(slices.reduce((s, x) => s + x.qty * x.unitPrice, 0));
  return { slices, totalCost };
}

export function partStock(batches: FifoBatchInput[], partId: string): number {
  return batches.filter((b) => b.partId === partId).reduce((s, b) => s + b.qtyRemaining, 0);
}

export function partValue(batches: FifoBatchInput[], partId: string): number {
  return money(
    batches
      .filter((b) => b.partId === partId)
      .reduce((s, b) => s + b.qtyRemaining * b.unitPrice, 0),
  );
}

export interface DealProfitInput {
  sellingPrice: number;
  discount: number;
  taxes: number;
  fees: number;
}

export interface DealProfit {
  totalCost: number;
  grossProfit: number;
  sellingExpenses: number;
  netProfit: number;
  marginPct: number;
  roiPct: number;
  breakEven: number;
}

/** Deal profitability: selling price − total cost − selling expenses = net profit. */
export function dealProfit(deal: DealProfitInput, totalCost: number): DealProfit {
  const netSelling = money(deal.sellingPrice - deal.discount);
  const sellingExpenses = money(deal.taxes + deal.fees);
  const grossProfit = money(netSelling - totalCost);
  const netProfit = money(grossProfit - sellingExpenses);
  return {
    totalCost: money(totalCost),
    grossProfit,
    sellingExpenses,
    netProfit,
    marginPct: netSelling > 0 ? money((netProfit / netSelling) * 100) : 0,
    roiPct: totalCost > 0 ? money((netProfit / totalCost) * 100) : 0,
    breakEven: money(totalCost + sellingExpenses),
  };
}

/**
 * All-in vehicle cost:
 * purchase + auction fees + transport + direct expenses + FIFO parts + overhead.
 */
export function vehicleAllInCost(
  vehicle: { purchasePrice: number; auctionFees: number; transportCost: number },
  directExpenses: number,
  partsCost: number,
  overheadPerVehicle: number,
): number {
  return money(
    vehicle.purchasePrice +
      vehicle.auctionFees +
      vehicle.transportCost +
      directExpenses +
      partsCost +
      overheadPerVehicle,
  );
}

export function daysInStock(purchaseDate: string, now = new Date()): number {
  const d = Math.floor((now.getTime() - new Date(purchaseDate).getTime()) / 86400000);
  return Math.max(0, d);
}
