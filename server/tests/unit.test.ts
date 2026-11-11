// Unit tests — pure logic only, no database, no network.
import { describe, expect, it } from 'vitest';
import { fifoConsume } from '../src/lib/fifo';
import { dealProfit, vehicleAllInCost } from '../src/lib/fifo';
import { money, num, round2 } from '../src/lib/money';
import { formatRef } from '../src/lib/refs';
import { parseCommand } from '../src/lib/ai-parser';

describe('FIFO (fifoConsume)', () => {
  const batches = [
    { id: 'b1', partId: 'p1', qtyRemaining: 10, unitPrice: 50, purchaseDate: '2026-01-01' },
    { id: 'b2', partId: 'p1', qtyRemaining: 10, unitPrice: 60, purchaseDate: '2026-01-02' },
  ];

  it('consumes 12 from 10@$50 + 10@$60 = $620', () => {
    const { slices, totalCost } = fifoConsume(batches, 'p1', 12);
    expect(totalCost).toBe(620);
    expect(slices).toEqual([
      { batchId: 'b1', qty: 10, unitPrice: 50 },
      { batchId: 'b2', qty: 2, unitPrice: 60 },
    ]);
  });

  it('consumes oldest batch first even when listed out of order', () => {
    const { slices } = fifoConsume([...batches].reverse(), 'p1', 5);
    expect(slices).toEqual([{ batchId: 'b1', qty: 5, unitPrice: 50 }]);
  });

  it('orders by purchaseDate, then id, on ties', () => {
    const tied = [
      { id: 'b2', partId: 'p1', qtyRemaining: 5, unitPrice: 60, purchaseDate: '2026-01-01' },
      { id: 'b1', partId: 'p1', qtyRemaining: 5, unitPrice: 50, purchaseDate: '2026-01-01' },
    ];
    const { slices } = fifoConsume(tied, 'p1', 5);
    expect(slices[0].batchId).toBe('b1');
  });

  it('throws on insufficient stock', () => {
    expect(() => fifoConsume(batches, 'p1', 21)).toThrow('Insufficient stock: 20 available, 21 requested');
  });

  it('throws on non-positive qty', () => {
    expect(() => fifoConsume(batches, 'p1', 0)).toThrow('Quantity to consume must be positive');
    expect(() => fifoConsume(batches, 'p1', -3)).toThrow('Quantity to consume must be positive');
  });

  it('ignores other parts and empty batches', () => {
    const mixed = [
      ...batches,
      { id: 'b3', partId: 'p2', qtyRemaining: 100, unitPrice: 1, purchaseDate: '2025-01-01' },
      { id: 'b4', partId: 'p1', qtyRemaining: 0, unitPrice: 999, purchaseDate: '2025-01-01' },
    ];
    const { totalCost } = fifoConsume(mixed, 'p1', 12);
    expect(totalCost).toBe(620);
  });
});

describe('dealProfit', () => {
  it('matches the frontend engine math', () => {
    // selling 15,900, no discount, taxes 200, fees 100, total cost 12,740
    const p = dealProfit({ sellingPrice: 15900, discount: 0, taxes: 200, fees: 100 }, 12740);
    expect(p.grossProfit).toBe(3160);
    expect(p.sellingExpenses).toBe(300);
    expect(p.netProfit).toBe(2860);
    expect(p.breakEven).toBe(13040);
    expect(p.marginPct).toBe(17.99);
    expect(p.roiPct).toBe(22.45);
  });

  it('applies the discount to the net selling price', () => {
    const p = dealProfit({ sellingPrice: 20000, discount: 1000, taxes: 0, fees: 0 }, 15000);
    expect(p.grossProfit).toBe(4000);
    expect(p.netProfit).toBe(4000);
    expect(p.marginPct).toBe(21.05);
  });

  it('handles a zero selling price without dividing by zero', () => {
    const p = dealProfit({ sellingPrice: 0, discount: 0, taxes: 0, fees: 0 }, 100);
    expect(p.marginPct).toBe(0);
    expect(p.netProfit).toBe(-100);
  });
});

describe('vehicleAllInCost', () => {
  it('sums purchase + fees + transport + direct + parts + overhead', () => {
    // Frontend seed case: 11200 + 380 + 550 + 460 direct + 0 parts + 150 overhead = 12740
    expect(
      vehicleAllInCost({ purchasePrice: 11200, auctionFees: 380, transportCost: 550 }, 460, 0, 150),
    ).toBe(12740);
  });
});

describe('money helpers', () => {
  it('rounds to 2dp', () => {
    expect(round2(10.125)).toBe(10.13);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(money(620.005)).toBe(620.01);
  });

  it('num() converts NUMERIC strings and never returns NaN', () => {
    expect(num('123.45')).toBe(123.45);
    expect(num(42)).toBe(42);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num('not-a-number')).toBe(0);
  });
});

describe('ref generation format', () => {
  it('formats refs as PREFIX-0001', () => {
    expect(formatRef('ACQ', 1)).toBe('ACQ-0001');
    expect(formatRef('DEAL', 42)).toBe('DEAL-0042');
    expect(formatRef('SALE', 1234)).toBe('SALE-1234');
    expect(formatRef('JE', 10000)).toBe('JE-10000');
  });
});

describe('AI command parser', () => {
  it('parses the six example commands', () => {
    expect(parseCommand('Add a 2022 Honda Accord for $16,500')).toEqual({
      kind: 'create_vehicle', year: 2022, make: 'Honda', model: 'Accord', price: 16500,
    });
    expect(parseCommand('Record $350 transportation for stock number CDT-101')).toEqual({
      kind: 'record_transport', amount: 350, stockNumber: 'CDT-101',
    });
    expect(parseCommand('Add $280 detailing expense to the Honda')).toEqual({
      kind: 'record_expense', amount: 280, category: 'Detailing', vehicleRef: 'Honda',
    });
    expect(parseCommand('Show all vehicles held for more than 45 days')).toEqual({
      kind: 'query_aged', days: 45,
    });
    expect(parseCommand('Which vehicles are losing money?')).toEqual({ kind: 'query_losing' });
    expect(parseCommand('Show customers who need follow-up')).toEqual({ kind: 'query_followups' });
  });

  it('flags sensitive operations before anything else', () => {
    const parsed = parseCommand('Sell the Honda Accord for $15,000');
    expect(parsed.kind).toBe('sensitive');
    if (parsed.kind === 'sensitive') expect(parsed.action).toBe('sell');
    expect(parseCommand('Pay the vendor $500').kind).toBe('sensitive');
  });

  it('returns unknown for unrecognised commands', () => {
    expect(parseCommand('What is the weather today?')).toEqual({ kind: 'unknown' });
  });
});
