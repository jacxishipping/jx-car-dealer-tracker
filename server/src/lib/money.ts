// Money helpers. Money is NUMERIC(12,2) in PostgreSQL and is returned to
// clients as JSON numbers, rounded to 2dp. pg returns NUMERIC as a string,
// so `num()` is the single place that conversion happens.

/** Round to 2 decimal places. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Alias kept for parity with the frontend engine (`money()` in types.ts). */
export const money = round2;

/** NUMERIC (string) / number / null → number. Never NaN. */
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Sum of money values, rounded to 2dp. */
export function sumMoney(values: number[]): number {
  return round2(values.reduce((s, v) => s + v, 0));
}
