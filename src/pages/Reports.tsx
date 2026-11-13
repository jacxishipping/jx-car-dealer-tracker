import { useMemo, useState } from 'react'

import { useStore } from '../store/store'
import { accountBalance, daysInStock, partStock, partValue, totalCash, vehicleAllInCost } from '../store/engine'
import { fmtMoney } from '../store/types'
import { EmptyState, ExportButton, Field, inputCls, PageHeader, TableScrollHint } from '../components/ui'

import {JXButton, JXCard} from '../components/JXUI'
type Row = Record<string, string | number | null | undefined>

const REPORTS = [
  { id: 'inventory', label: 'Inventory report', desc: 'Every vehicle, its status and all-in cost.' },
  { id: 'acquisition', label: 'Acquisition report', desc: 'Purchases in the period, by source and seller.' },
  { id: 'sales', label: 'Sales report', desc: 'Finalised sales, revenue and profit.' },
  { id: 'profitability', label: 'Profitability report', desc: 'Per-vehicle profit on sold stock.' },
  { id: 'expense', label: 'Expense report', desc: 'Expenses in the period, by category and kind.' },
  { id: 'recon', label: 'Reconditioning report', desc: 'Recon jobs, estimated vs actual cost.' },
  { id: 'parts-valuation', label: 'Parts valuation', desc: 'Parts on hand at FIFO batch value.' },
  { id: 'fifo', label: 'FIFO costing report', desc: 'Parts consumed, valued oldest-batch-first.' },
  { id: 'cashflow', label: 'Cash flow report', desc: 'Money in and out by transaction type.' },
  { id: 'balances', label: 'Account balances', desc: 'Computed balance per account (snapshot).' },
  { id: 'receivables', label: 'Receivables & payables', desc: 'Outstanding customer, vendor and carrier balances.' },
  { id: 'pnl', label: 'Monthly P&L', desc: 'Sales revenue − COGS − overhead for one month.' },
  { id: 'aging', label: 'Inventory aging', desc: 'Days in stock, bucketed 0–30 / 31–45 / 46–90 / 90+.' },
  { id: 'crm', label: 'CRM conversion report', desc: 'Leads by stage and the Sold / Lost rate.' },
  { id: 'salesperson', label: 'Salesperson performance', desc: 'Deals and realised profit per salesperson.' },
] as const

type ReportId = (typeof REPORTS)[number]['id']

const thCls = 'border-b border-slate-200 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400'
const tdCls = 'border-b border-slate-100 px-4 py-2.5 text-slate-700 dark:border-slate-700 dark:text-slate-300'
const inRange = (date: string, from: string, to: string) => date >= from && date <= to

export default function Reports() {
  const { state } = useStore()
  const [selected, setSelected] = useState<ReportId>('inventory')
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  const def = REPORTS.find((r) => r.id === selected)!

  const result = useMemo((): { summary: { label: string; value: string }[]; columns: string[]; rows: Row[]; note?: string } => {
    const money = fmtMoney
    switch (selected) {
      case 'inventory': {
        const rows = state.vehicles.map((v) => ({
          stock: v.stockNumber, vehicle: `${v.year} ${v.make} ${v.model}`, status: v.status,
          purchase_date: v.purchaseDate, purchase_price: v.purchasePrice, all_in_cost: vehicleAllInCost(v, state.expenses, state.partAllocations, state.settings.overheadPerVehicle),
          asking_price: v.askingPrice,
        }))
        const total = rows.reduce((s, r) => s + r.all_in_cost, 0)
        return { summary: [{ label: 'Vehicles', value: String(rows.length) }, { label: 'Total all-in cost', value: money(total) }], columns: ['stock', 'vehicle', 'status', 'purchase_date', 'purchase_price', 'all_in_cost', 'asking_price'], rows, note: 'Snapshot — not date-filtered. All-in cost = purchase + fees + transport + direct expenses + FIFO parts + overhead allocation.' }
      }
      case 'acquisition': {
        const list = state.purchases.filter((p) => inRange(p.purchaseDate, from, to))
        const rows = list.map((p) => {
          const v = state.vehicles.find((x) => x.id === p.vehicleId)
          return { ref: p.ref, date: p.purchaseDate, vehicle: v ? `${v.year} ${v.make} ${v.model}` : p.vehicleId, seller: p.seller, source: v?.purchaseSource ?? '', vehicle_price: p.vehiclePrice, fees: p.buyerFees + p.auctionFees, taxes: p.taxes, total: p.vehiclePrice + p.buyerFees + p.auctionFees + p.taxes, payment_status: p.paymentStatus }
        })
        return { summary: [{ label: 'Purchases', value: String(rows.length) }, { label: 'Total acquisition cost', value: money(rows.reduce((s, r) => s + (r.total as number), 0)) }], columns: ['ref', 'date', 'vehicle', 'seller', 'source', 'vehicle_price', 'fees', 'taxes', 'total', 'payment_status'], rows }
      }
      case 'sales': {
        const list = state.sales.filter((s) => inRange(s.date, from, to))
        const rows = list.map((s) => {
          const v = state.vehicles.find((x) => x.id === s.vehicleId)
          const c = state.customers.find((x) => x.id === s.customerId)
          return { ref: s.ref, date: s.date, vehicle: v ? `${v.year} ${v.make} ${v.model}` : '', customer: c?.name ?? '', selling_price: s.sellingPrice, total_cost: s.totalCost, gross_profit: s.grossProfit, net_profit: s.netProfit, margin_pct: `${s.marginPct}%` }
        })
        return { summary: [{ label: 'Sales', value: String(rows.length) }, { label: 'Revenue', value: money(rows.reduce((s, r) => s + (r.selling_price as number), 0)) }, { label: 'Net profit', value: money(rows.reduce((s, r) => s + (r.net_profit as number), 0)) }], columns: ['ref', 'date', 'vehicle', 'customer', 'selling_price', 'total_cost', 'gross_profit', 'net_profit', 'margin_pct'], rows }
      }
      case 'profitability': {
        const list = state.sales.filter((s) => inRange(s.date, from, to))
        const rows = list.map((s) => {
          const v = state.vehicles.find((x) => x.id === s.vehicleId)
          return { ref: s.ref, vehicle: v ? `${v.year} ${v.make} ${v.model}` : '', selling_price: s.sellingPrice, total_cost: s.totalCost, net_profit: s.netProfit, margin_pct: `${s.marginPct}%`, roi_pct: s.totalCost > 0 ? `${((s.netProfit / s.totalCost) * 100).toFixed(1)}%` : '—' }
        })
        return { summary: [{ label: 'Sold vehicles', value: String(rows.length) }, { label: 'Total net profit', value: money(rows.reduce((s, r) => s + (r.net_profit as number), 0)) }, { label: 'Avg margin', value: rows.length ? `${(rows.reduce((s, r) => s + parseFloat(String(r.margin_pct).replace('%', '')), 0) / rows.length).toFixed(1)}%` : '—' }], columns: ['ref', 'vehicle', 'selling_price', 'total_cost', 'net_profit', 'margin_pct', 'roi_pct'], rows }
      }
      case 'expense': {
        const list = state.expenses.filter((e) => inRange(e.date, from, to))
        const rows = list.map((e) => ({ date: e.date, description: e.description, category: e.category, kind: e.kind, vendor: e.vendor, amount: e.amount, status: e.status, invoice: e.invoiceRef }))
        const direct = rows.filter((r) => r.kind === 'Direct').reduce((s, r) => s + (r.amount as number), 0)
        const overhead = rows.filter((r) => r.kind === 'Overhead').reduce((s, r) => s + (r.amount as number), 0)
        return { summary: [{ label: 'Expenses', value: String(rows.length) }, { label: 'Direct', value: money(direct) }, { label: 'Overhead', value: money(overhead) }, { label: 'Total', value: money(direct + overhead) }], columns: ['date', 'description', 'category', 'kind', 'vendor', 'amount', 'status', 'invoice'], rows }
      }
      case 'recon': {
        const rows = state.reconJobs.map((j) => {
          const v = state.vehicles.find((x) => x.id === j.vehicleId)
          return { vehicle: v?.stockNumber ?? j.vehicleId, title: j.title, category: j.category, status: j.status, technician: j.technician, estimated: j.estimatedCost, actual: j.actualCost, variance: j.actualCost - j.estimatedCost, started: j.startedAt, completed: j.completedAt ?? '—' }
        })
        return { summary: [{ label: 'Jobs', value: String(rows.length) }, { label: 'Estimated total', value: money(rows.reduce((s, r) => s + (r.estimated as number), 0)) }, { label: 'Actual total', value: money(rows.reduce((s, r) => s + (r.actual as number), 0)) }], columns: ['vehicle', 'title', 'category', 'status', 'technician', 'estimated', 'actual', 'variance', 'started', 'completed'], rows, note: 'Snapshot — not date-filtered.' }
      }
      case 'parts-valuation': {
        const rows = state.parts.map((p) => ({ sku: p.sku, part: p.name, supplier: p.supplier, on_hand: partStock(state.partBatches, p.id), value: partValue(state.partBatches, p.id), min_stock: p.minStock }))
        return { summary: [{ label: 'Parts', value: String(rows.length) }, { label: 'Total inventory value', value: money(rows.reduce((s, r) => s + (r.value as number), 0)) }], columns: ['sku', 'part', 'supplier', 'on_hand', 'value', 'min_stock'], rows, note: 'Snapshot — value is the remaining FIFO batches at their purchase prices.' }
      }
      case 'fifo': {
        const rows = state.partAllocations.map((a) => {
          const p = state.parts.find((x) => x.id === a.partId)
          const v = state.vehicles.find((x) => x.id === a.vehicleId)
          return { date: a.date, part: p?.name ?? a.partId, vehicle: v?.stockNumber ?? a.vehicleId, qty: a.qty, fifo_cost: a.fifoCost, batches: a.batches.map((b) => `${b.qty} @ $${b.unitPrice}`).join('; ') }
        })
        return { summary: [{ label: 'Allocations', value: String(rows.length) }, { label: 'Total FIFO cost', value: money(rows.reduce((s, r) => s + (r.fifo_cost as number), 0)) }], columns: ['date', 'part', 'vehicle', 'qty', 'fifo_cost', 'batches'], rows }
      }
      case 'cashflow': {
        const list = state.transactions.filter((t) => inRange(t.date, from, to))
        const byType = new Map<string, number>()
        for (const t of list) byType.set(t.type, (byType.get(t.type) ?? 0) + t.amount)
        const rows = [...byType.entries()].map(([type, amount]) => ({ type, amount, direction: amount >= 0 ? 'In' : 'Out' }))
        const inflow = list.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
        const outflow = list.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)
        return { summary: [{ label: 'Cash in', value: money(inflow) }, { label: 'Cash out', value: money(outflow) }, { label: 'Net cash flow', value: money(inflow + outflow) }], columns: ['type', 'amount', 'direction'], rows }
      }
      case 'balances': {
        const rows = state.accounts.map((a) => ({ account: a.name, type: a.type, opening: a.openingBalance, balance: accountBalance(state, a.id), status: a.status }))
        return { summary: [{ label: 'Accounts', value: String(rows.length) }, { label: 'Total cash', value: money(totalCash(state)) }], columns: ['account', 'type', 'opening', 'balance', 'status'], rows, note: 'Snapshot — balances are computed from opening balance + signed transactions.' }
      }
      case 'receivables': {
        const rows = state.receivables.map((r) => ({ kind: r.kind, entity: r.entityName, reference: r.reference, total: r.total, paid: r.paid, outstanding: r.total - r.paid, due_date: r.dueDate, status: r.status }))
        const recOut = state.receivables.filter((r) => r.kind === 'Customer').reduce((s, r) => s + (r.total - r.paid), 0)
        const payOut = state.receivables.filter((r) => r.kind !== 'Customer').reduce((s, r) => s + (r.total - r.paid), 0)
        return { summary: [{ label: 'Receivables outstanding', value: money(recOut) }, { label: 'Payables outstanding', value: money(payOut) }], columns: ['kind', 'entity', 'reference', 'total', 'paid', 'outstanding', 'due_date', 'status'], rows, note: 'Snapshot — not date-filtered.' }
      }
      case 'pnl': {
        const list = state.sales.filter((s) => s.date.startsWith(month))
        const revenue = list.reduce((s, x) => s + x.sellingPrice, 0)
        const cogs = list.reduce((s, x) => s + x.totalCost, 0)
        const overhead = state.expenses.filter((e) => e.kind === 'Overhead' && e.date.startsWith(month)).reduce((s, e) => s + e.amount, 0)
        const rows = [
          { line: 'Sales revenue', amount: revenue },
          { line: 'Cost of goods sold (sum of sale totalCost)', amount: -cogs },
          { line: 'Gross profit', amount: revenue - cogs },
          { line: 'Overhead expenses', amount: -overhead },
          { line: 'Net profit', amount: revenue - cogs - overhead },
        ]
        return { summary: [{ label: 'Month', value: month }, { label: 'Sales', value: String(list.length) }, { label: 'Net profit', value: money(revenue - cogs - overhead) }], columns: ['line', 'amount'], rows, note: 'P&L for the selected month only — use the month picker, not the date range.' }
      }
      case 'aging': {
        const inStock = state.vehicles.filter((v) => v.status !== 'Sold' && v.status !== 'Wholesale' && v.status !== 'Returned')
        const bucket = (d: number) => (d <= 30 ? '0–30 days' : d <= 45 ? '31–45 days' : d <= 90 ? '46–90 days' : '90+ days')
        const rows = inStock.map((v) => {
          const d = daysInStock(v)
          return { stock: v.stockNumber, vehicle: `${v.year} ${v.make} ${v.model}`, status: v.status, purchase_date: v.purchaseDate, days_in_stock: d, bucket: bucket(d), over_target: d > state.settings.targetHoldDays ? 'Yes' : 'No' }
        }).sort((a, b) => (b.days_in_stock as number) - (a.days_in_stock as number))
        const counts = ['0–30 days', '31–45 days', '46–90 days', '90+ days'].map((b) => ({ label: b, value: String(rows.filter((r) => r.bucket === b).length) }))
        return { summary: [{ label: 'Vehicles in stock', value: String(rows.length) }, ...counts, { label: 'Target hold', value: `${state.settings.targetHoldDays} days` }], columns: ['stock', 'vehicle', 'status', 'purchase_date', 'days_in_stock', 'bucket', 'over_target'], rows, note: 'Snapshot — days in stock are counted from purchase date to today.' }
      }
      case 'crm': {
        const stages = ['New Lead', 'Contacted', 'Viewing', 'Negotiation', 'Sold', 'Lost'] as const
        const rows = stages.map((stage) => {
          const leads = state.leads.filter((l) => l.stage === stage)
          return { stage, leads: leads.length, share_pct: state.leads.length ? `${((leads.length / state.leads.length) * 100).toFixed(1)}%` : '0%' }
        })
        const sold = state.leads.filter((l) => l.stage === 'Sold').length
        const lost = state.leads.filter((l) => l.stage === 'Lost').length
        const rate = sold + lost > 0 ? `${((sold / (sold + lost)) * 100).toFixed(1)}%` : '—'
        return { summary: [{ label: 'Total leads', value: String(state.leads.length) }, { label: 'Sold', value: String(sold) }, { label: 'Lost', value: String(lost) }, { label: 'Conversion (Sold / closed)', value: rate }], columns: ['stage', 'leads', 'share_pct'], rows, note: 'Snapshot — not date-filtered.' }
      }
      case 'salesperson': {
        const map = new Map<string, { deals: number; revenue: number; profit: number }>()
        for (const sale of state.sales.filter((s) => inRange(s.date, from, to))) {
          const deal = state.deals.find((d) => d.id === sale.dealId)
          const name = deal?.salesperson ?? 'Unassigned'
          const cur = map.get(name) ?? { deals: 0, revenue: 0, profit: 0 }
          cur.deals += 1; cur.revenue += sale.sellingPrice; cur.profit += sale.netProfit
          map.set(name, cur)
        }
        const rows = [...map.entries()].map(([salesperson, v]) => ({ salesperson, deals: v.deals, revenue: v.revenue, realised_profit: v.profit, avg_profit_per_deal: v.deals ? Math.round((v.profit / v.deals) * 100) / 100 : 0 }))
          .sort((a, b) => (b.revenue as number) - (a.revenue as number))
        return { summary: [{ label: 'Salespeople with sales', value: String(rows.length) }, { label: 'Revenue', value: money(rows.reduce((s, r) => s + (r.revenue as number), 0)) }, { label: 'Realised profit', value: money(rows.reduce((s, r) => s + (r.realised_profit as number), 0)) }], columns: ['salesperson', 'deals', 'revenue', 'realised_profit', 'avg_profit_per_deal'], rows }
      }
    }
  }, [selected, state, from, to, month])

  const isMoneyCol = (c: string) => /price|cost|amount|total|paid|outstanding|revenue|profit|balance|opening|value|estimated|actual|variance|fees|taxes/.test(c)

  return (
    <>
      <PageHeader title="Reports" subtitle="Pick a report, set the period, review the computed summary and export it as CSV. Nothing here is pre-written — every row is computed from live state." />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="flex gap-2 overflow-x-auto pb-2 lg:grid lg:gap-2 lg:overflow-visible lg:pb-0">
          {REPORTS.map((r) => (
            <JXButton key={r.id} variant={selected === r.id ? 'contained' : 'outlined'} size="sm" lockWidth={false} className="shrink-0 lg:w-full" onClick={() => setSelected(r.id)}>
              <span className="text-left">{r.label}</span>
            </JXButton>
          ))}
        </aside>

        <section>
          <JXCard title={def.label} kicker="Report" description={def.desc}
            className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              {selected === 'pnl' ? (
                <Field label="Month">
                  <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} />
                </Field>
              ) : (
                <>
                  <Field label="From">
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="To">
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
                  </Field>
                </>
              )}
              <ExportButton filename={`report-${selected}.csv`} rows={result.rows} label="Export CSV" />
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {result.summary.map((s) => (
                  <div key={s.label} className="rounded-[var(--radius-control)] bg-slate-50 px-3 py-2 dark:bg-slate-900">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{s.label}</p>
                    <p className="font-mono text-lg font-semibold text-slate-900 dark:text-white">{s.value}</p>
                  </div>
              ))}
                </div>
            { result.note && <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{result.note}</p> }

            {
                  result.rows.length === 0
                    ? <EmptyState title="No rows for this report" detail="Nothing in the data matches the selected report and period." />
                    : (
                <>
                  <TableScrollHint />
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead><tr>{result.columns.map((c) => <th key={c} className={thCls}>{c.replace(/_/g, ' ')}</th>)}</tr></thead>
                      <tbody>
                        {result.rows.map((row, i) => (
                          <tr key={i}>
                            {result.columns.map((c) => (
                              <td key={c} className={`${tdCls} ${typeof row[c] === 'number' ? 'font-mono' : ''}`}>
                                {typeof row[c] === 'number' && isMoneyCol(c) ? fmtMoney(row[c] as number) : String(row[c] ?? '—')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
                    )
                }
          </JXCard>
        </section>
      </div>
    </>
  )
}
