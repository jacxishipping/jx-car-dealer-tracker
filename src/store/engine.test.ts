// Engine unit tests — pure functions only, no React.
// Run with `npm test` (vitest run). Covers the money engine that every
// module in the app depends on: FIFO parts costing, all-in vehicle cost,
// deal profit, and the seed-data invariants the sale figures rest on.
import { describe, expect, it } from 'vitest'
import {
  dealProfit, fifoConsume, vehicleAllInCost,
} from './engine'
import { buildSeedState } from './seed'
import type { PartBatch } from './types'

const batches = (rows: { id: string; qty: number; price: number; date: string }[]): PartBatch[] =>
  rows.map((r) => ({
    id: r.id, partId: 'part-001', qtyReceived: r.qty, qtyRemaining: r.qty,
    unitPrice: r.price, invoice: `INV-${r.id}`, purchaseDate: r.date,
  }))

describe('fifoConsume', () => {
  it('(a) FIFO example: 10 @ $50 + 10 @ $60, consume 12 → $620 in two slices', () => {
    const { slices, totalCost } = fifoConsume(
      batches([
        { id: 'b-1', qty: 10, price: 50, date: '2026-10-01' },
        { id: 'b-2', qty: 10, price: 60, date: '2026-10-22' },
      ]),
      'part-001',
      12,
    )
    expect(totalCost).toBe(620)
    expect(slices).toEqual([
      { batchId: 'b-1', qty: 10, unitPrice: 50 },
      { batchId: 'b-2', qty: 2, unitPrice: 60 },
    ])
  })

  it('(a) consumes oldest batch first even when batches are listed out of order', () => {
    const { slices } = fifoConsume(
      batches([
        { id: 'b-2', qty: 10, price: 60, date: '2026-10-22' },
        { id: 'b-1', qty: 10, price: 50, date: '2026-10-01' },
      ]),
      'part-001',
      5,
    )
    expect(slices).toEqual([{ batchId: 'b-1', qty: 5, unitPrice: 50 }])
  })

  it('(b) throws on insufficient stock and does not partially consume', () => {
    expect(() =>
      fifoConsume(
        batches([{ id: 'b-1', qty: 10, price: 50, date: '2026-10-01' }]),
        'part-001',
        11,
      ),
    ).toThrow(/Insufficient stock: 10 available, 11 requested/)
  })

  it('(b) throws on a non-positive quantity', () => {
    const bs = batches([{ id: 'b-1', qty: 10, price: 50, date: '2026-10-01' }])
    expect(() => fifoConsume(bs, 'part-001', 0)).toThrow(/must be positive/)
    expect(() => fifoConsume(bs, 'part-001', -3)).toThrow(/must be positive/)
  })
})

describe('vehicleAllInCost', () => {
  // NOTE — the brief's own arithmetic was wrong by $150 here (it stated
  // 11200 + 380 + 550 + 460 + 0 + 150 = 12890; the sum is 12740). The seed
  // sale s-001 snapshot was corrected at integration to the engine values
  // (totalCost 12740, gross 3160, net 3040); the engine is authoritative.
  it('(c) all-in cost: 11200 purchase + 380 fees + 550 transport + 460 direct + 0 parts + 150 overhead = 12740', () => {
    const state = buildSeedState()
    const v = state.vehicles.find((x) => x.id === 'v-004')
    expect(v).toBeDefined()
    // Seed direct expenses for v-004: e-002 detailing $280 + e-003 inspection $180 = $460.
    // No part allocations exist for v-004, so parts cost is $0.
    expect(vehicleAllInCost(v!, state.expenses, state.partAllocations, state.settings.overheadPerVehicle))
      .toBe(12740)
    // The brief's expected 12890 does not follow from its own components:
    expect(11200 + 380 + 550 + 460 + 0 + 150).toBe(12740)
  })

  it('(c) breaks down as purchase + fees + transport + direct expenses + parts + overhead', () => {
    const state = buildSeedState()
    const v = state.vehicles.find((x) => x.id === 'v-004')!
    const direct = state.expenses
      .filter((e) => e.vehicleId === 'v-004' && e.kind === 'Direct')
      .reduce((s, e) => s + e.amount, 0)
    const parts = state.partAllocations
      .filter((a) => a.vehicleId === 'v-004')
      .reduce((s, a) => s + a.fifoCost, 0)
    expect(v.purchasePrice).toBe(11200)
    expect(v.auctionFees).toBe(380)
    expect(v.transportCost).toBe(550)
    expect(direct).toBe(460)
    expect(parts).toBe(0)
    expect(state.settings.overheadPerVehicle).toBe(150)
    expect(11200 + 380 + 550 + direct + parts + 150).toBe(12740)
  })
})

describe('dealProfit', () => {
  it('(d) dealProfit is internally consistent for the seed sale inputs: selling 15900, discount 0, taxes 0, fees 120, totalCost 12740 → gross 3160, net 3040, margin ~19.1%', () => {
    const p = dealProfit({ sellingPrice: 15900, discount: 0, taxes: 0, fees: 120 }, 12740)
    expect(p.totalCost).toBe(12740)
    expect(p.grossProfit).toBe(3160)
    expect(p.sellingExpenses).toBe(120)
    expect(p.netProfit).toBe(3040)
    // Engine margin is net / net-selling price: 3040 / 15900 = 19.119…% → 19.12.
    expect(p.marginPct).toBeCloseTo(19.12, 2)
    expect(p.marginPct).toBeCloseTo(19.1, 1)
    expect(p.breakEven).toBe(12860)
  })
})

describe('seed invariants', () => {
  it('(e) VIN duplicate check is a store concern — the seed itself has no duplicate VINs', () => {
    const state = buildSeedState()
    const vins = state.vehicles.map((v) => v.vin.toUpperCase())
    expect(new Set(vins).size).toBe(vins.length)
    expect(vins.length).toBeGreaterThan(0)
  })

  it('(f) sale finalisation invariants: engine recomputation for v-004 equals the seed sale s-001 snapshot', () => {
    // The brief's hand-written s-001 snapshot originally recorded 12890 /
    // 3010 / 2890 (the brief's own sum was wrong by $150); it was corrected
    // at integration so the snapshot agrees with the engine exactly.
    const state = buildSeedState()
    const v = state.vehicles.find((x) => x.id === 'v-004')!
    const deal = state.deals.find((d) => d.id === 'd-001')!
    const sale = state.sales.find((s) => s.id === 's-001')!
    const totalCost = vehicleAllInCost(v, state.expenses, state.partAllocations, state.settings.overheadPerVehicle)
    const profit = dealProfit(deal, totalCost)
    expect(totalCost).toBe(12740)
    expect(profit.grossProfit).toBe(3160)
    expect(profit.netProfit).toBe(3040)
    // The seed snapshot now matches the engine exactly — no gap.
    expect(sale.totalCost).toBe(totalCost)
    expect(sale.totalCost).toBe(12740)
    expect(sale.grossProfit).toBe(3160)
    expect(sale.netProfit).toBe(3040)
    expect(sale.grossProfit).toBe(profit.grossProfit)
    expect(sale.netProfit).toBe(profit.netProfit)
    // Seed stores marginPct rounded to 1dp (19.1); the engine computes 19.12.
    expect(profit.marginPct).toBeCloseTo(19.12, 2)
    expect(sale.sellingPrice).toBe(deal.sellingPrice - deal.discount)
  })
})
