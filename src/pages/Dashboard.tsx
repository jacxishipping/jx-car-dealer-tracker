import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Clock, Package, TrendingUp, Wallet } from 'lucide-react'

import { useStore } from '../store/store'
import { dashboardKpis, daysInStock, forecast, monthlySeries, partStock } from '../store/engine'
import { fmtMoney } from '../store/types'
import { Alert, BarChart, Donut, KpiCard, Money, PageHeader, StatusChip } from '../components/ui'

import {JXCard, JXSelect} from '../components/JXUI'
const STATUS_COLORS: Record<string, string> = {
  Purchased: '#64748b', 'Awaiting pickup': '#f59e0b', 'In transit': '#0ea5e9', Received: '#10b981',
  Inspection: '#f59e0b', 'In reconditioning': '#f97316', Available: '#10b981', Reserved: '#4f46e5',
  Sold: '#4f46e5', Returned: '#f43f5e', Wholesale: '#64748b',
}

export default function Dashboard() {
  const { state } = useStore()
  const [alertFilter, setAlertFilter] = useState('All')
  const kpis = dashboardKpis(state)
  const series = monthlySeries(state, 6)
  const fc = forecast(state)
  const [today] = useState(() => new Date().toISOString().slice(0, 10))

  const statusCounts = state.vehicles.reduce<Record<string, number>>((acc, v) => {
    acc[v.status] = (acc[v.status] ?? 0) + 1
    return acc
  }, {})
  const donutSegments = Object.entries(statusCounts)
    .filter(([, n]) => n > 0)
    .map(([label, value]) => ({ label, value, color: STATUS_COLORS[label] ?? '#64748b' }))

  const aged = state.vehicles.filter(
    (v) => !['Sold', 'Wholesale', 'Returned'].includes(v.status) && daysInStock(v) > state.settings.targetHoldDays,
  )
  const unpaidTransport = state.transport.filter((t) => t.paymentStatus !== 'Paid')
  const unpaidReceivables = state.receivables.filter((r) => r.status !== 'Paid' && r.total - r.paid > 0)
  const lowStockParts = state.parts.filter((p) => partStock(state.partBatches, p.id) < p.minStock)
  const overdueFollowUps = state.leads.filter(
    (l) => l.followUpDate < today && !['Sold', 'Lost'].includes(l.stage),
  )
  const visibleAlerts = (alertFilter === 'All' ? aged.length + unpaidTransport.length + unpaidReceivables.length + lowStockParts.length + overdueFollowUps.length
    : alertFilter === 'Aged stock' ? aged.length
      : alertFilter === 'Unpaid transport' ? unpaidTransport.length
        : alertFilter === 'Receivables' ? unpaidReceivables.length
          : alertFilter === 'Low parts' ? lowStockParts.length : overdueFollowUps.length)

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${state.settings.orgName} — ${kpis.stockCount} vehicles in stock · ${state.vehicles.length} total vehicles`}
        actions={
            <Link to="/inventory" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-control)] bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              View inventory <ArrowRight className="h-4 w-4" />
            </Link>
        }
      />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <KpiCard label="Inventory value" value={fmtMoney(kpis.inventoryValue)} sub={`${kpis.stockCount} vehicles in stock`} tone="indigo" />
              <KpiCard label="Acquisition cost" value={fmtMoney(kpis.acquisitionCost)} sub="Purchase price + auction fees, all vehicles" tone="sky" />
              <KpiCard label="Sales revenue" value={fmtMoney(kpis.salesRevenue)} sub={`${kpis.sold} sold`} tone="emerald" />
              <KpiCard label="Gross profit" value={fmtMoney(kpis.grossProfit)} sub="Revenue − vehicle costs" tone="emerald" />
              <KpiCard label="Net profit" value={fmtMoney(kpis.netProfit)} sub={`Margin ${kpis.marginPct.toFixed(1)}% of revenue`} tone={kpis.netProfit >= 0 ? 'emerald' : 'rose'} />
              <KpiCard label="Total expenses" value={fmtMoney(kpis.totalExpenses)} sub="Direct + overhead" tone="amber" />
              <KpiCard label="Cash" value={fmtMoney(kpis.cash)} sub="All accounts combined" tone="sky" />
              <KpiCard label="Receivables" value={fmtMoney(kpis.receivables)} sub="Owed by customers" tone="amber" />
              <KpiCard label="Payables" value={fmtMoney(kpis.payables)} sub="Owed to vendors / carriers" tone="rose" />
              <KpiCard label="In transit / recon" value={`${kpis.inTransit} / ${kpis.inRecon}`} sub={`${kpis.available} available · ${kpis.reserved} reserved`} tone="indigo" />
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <JXCard title="Monthly revenue & profit" kicker="Last 6 months" description="Revenue (indigo) and net profit (green) from completed sales." className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                  <BarChart data={series.map((m) => ({ label: m.label, value: m.revenue, value2: m.profit }))} />
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    {series.map((m) => (
                      <span key={m.label}>{m.label}: <Money value={m.revenue} /> rev · <Money value={m.profit} /> profit</span>
                    ))}
                  </div>
                </JXCard>

                  <JXCard title="Inventory by status" kicker="Inventory intelligence" description="Where every vehicle sits in the pipeline right now." className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                    {state.vehicles.length === 0 ? (
                        <div className="flex flex-col items-start gap-3 rounded-[var(--radius-control)] border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                          <p className="text-sm text-slate-600 dark:text-slate-300">
                            No vehicles in inventory yet. Record your first acquisition to populate stock, cost basis, and ledger entries.
                          </p>
                          <Link
                            to="/purchases?new=1"
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-control)] bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                          >
                            + Record first purchase
                          </Link>
                        </div>
                        ) : (
                        <Donut segments={donutSegments} total={state.vehicles.length} label="vehicles" />
          )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {Object.entries(statusCounts).map(([s, n]) => (
                            <span key={s} className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                              <StatusChip value={s} /><span className="font-mono font-semibold">{n}</span>
                            </span>
                          ))}
                        </div>
                      </JXCard>
      </div>

                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                      <JXCard title="Operational alerts" kicker="Needs attention" description={`Target hold is ${state.settings.targetHoldDays} days. ${aged.length + unpaidTransport.length + unpaidReceivables.length + lowStockParts.length + overdueFollowUps.length} open alerts.`} className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                          <p className="text-xs text-slate-500 dark:text-slate-400">Showing {visibleAlerts} of {aged.length + unpaidTransport.length + unpaidReceivables.length + lowStockParts.length + overdueFollowUps.length} items</p>
                          <div className="w-full sm:w-52"><JXSelect label="Filter alerts" className="jx-select-field jx-field-select" value={alertFilter} onChange={setAlertFilter} options={['All', 'Aged stock', 'Unpaid transport', 'Receivables', 'Low parts', 'Overdue follow-ups'].map((filter) => ({ id: filter, label: filter }))} /></div>
                        </div>
                        <ul className="space-y-3 text-sm">
                          {visibleAlerts === 0 && (
                            <li className="text-slate-500 dark:text-slate-400">No open alerts in this view.</li>
                          )}
                          {(alertFilter === 'All' || alertFilter === 'Aged stock') && aged.map((v) => (
                            <li key={`aged-${v.id}`} className="flex items-start gap-2">
                              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                              <span>
                                <Link to={`/inventory/${v.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">{v.stockNumber} — {v.year} {v.make} {v.model}</Link>
                                {' '}aged {daysInStock(v)} days in stock (target {state.settings.targetHoldDays}).
                              </span>
                            </li>
                          ))}
                          {(alertFilter === 'All' || alertFilter === 'Unpaid transport') && unpaidTransport.map((t) => {
                            const v = state.vehicles.find((x) => x.id === t.vehicleId)
                            return (
                              <li key={`tr-${t.id}`} className="flex items-start gap-2">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                                <Link to="/transportation" className="min-w-0 flex-1 rounded-sm hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:text-indigo-300"><span>Unpaid transport — {t.carrier} ({t.invoiceRef || 'no invoice ref'}) for {v ? `${v.stockNumber} ${v.year} ${v.make} ${v.model}` : t.vehicleId}: <Money value={t.price} /> · {t.paymentStatus}.</span><span className="ml-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400">Open transportation →</span></Link>
                              </li>
                            )
                          })}
                          {(alertFilter === 'All' || alertFilter === 'Receivables') && unpaidReceivables.map((r) => (
                            <li key={`rc-${r.id}`} className="flex items-start gap-2">
                              <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                              <Link to="/finance" className="min-w-0 flex-1 rounded-sm hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:text-indigo-300"><span>Unpaid {r.kind.toLowerCase()} balance — {r.entityName} ({r.reference}): <Money value={r.total - r.paid} /> outstanding, due {r.dueDate} · {r.status}.</span><span className="ml-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400">Open finance →</span></Link>
                            </li>
                          ))}
                          {(alertFilter === 'All' || alertFilter === 'Low parts') && lowStockParts.map((p) => (
                            <li key={`ps-${p.id}`} className="flex items-start gap-2">
                              <Package className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                              <Link to="/parts" className="min-w-0 flex-1 rounded-sm hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:text-indigo-300"><span>Low stock — {p.name} ({p.sku}): {partStock(state.partBatches, p.id)} on hand, minimum {p.minStock}.</span><span className="ml-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400">Open parts →</span></Link>
                            </li>
                          ))}
                          {(alertFilter === 'All' || alertFilter === 'Overdue follow-ups') && overdueFollowUps.map((l) => {
                            const c = state.customers.find((x) => x.id === l.customerId)
                            return (
                              <li key={`fu-${l.id}`} className="flex items-start gap-2">
                                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                                <Link to="/crm?followUp=overdue" className="min-w-0 flex-1 rounded-sm hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:text-indigo-300"><span>Overdue follow-up — {c?.name ?? l.customerId} ({l.stage}), was due {l.followUpDate}.</span><span className="ml-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400">Review follow-up →</span></Link>
                              </li>
                            )
                          })}
                        </ul>
                      </JXCard>

                        <JXCard title="AI forecast — next month" kicker="Forecast · not actuals" description="Projected from the average of the last 6 months of sales, with a trend adjustment. These are estimates, not recorded revenue or profit." className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                          <div className="flex items-start gap-2">
                            <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                              Baseline forecast for next month: <Money value={fc.baseline} className="font-semibold text-slate-900 dark:text-white" /> revenue
                              and <Money value={fc.nextProfit} className="font-semibold text-slate-900 dark:text-white" /> profit
                              (margin {fc.marginPct.toFixed(1)}%).
                            </p>
                          </div>
                          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                              <div className="rounded-[var(--radius-control)] bg-slate-50 p-3 dark:bg-slate-900">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Conservative</p>
                                <p className="mt-1 font-mono text-lg font-semibold text-slate-900 dark:text-white">{fmtMoney(fc.conservative)}</p>
                              </div>
                                <div className="rounded-[var(--radius-control)] bg-indigo-50 p-3 dark:bg-indigo-950">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Baseline</p>
                                  <p className="mt-1 font-mono text-lg font-semibold text-indigo-700 dark:text-indigo-200">{fmtMoney(fc.baseline)}</p>
                                </div>
                                  <div className="rounded-[var(--radius-control)] bg-emerald-50 p-3 dark:bg-emerald-950">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Optimistic</p>
                                    <p className="mt-1 font-mono text-lg font-semibold text-emerald-700 dark:text-emerald-200">{fmtMoney(fc.optimistic)}</p>
                                  </div>
                                </div>
                                <div className="mt-4">
                                  <Alert severity="info" title="Forecast only" description="Figures above are projections from past sales averages. They are not actuals and do not change any ledger, inventory value, or KPI on this page." />
                                </div>
                                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                                    Recent sales: {state.sales.length === 0 ? 'none recorded yet.' : state.sales.map((s) => `${s.ref} ${fmtMoney(s.sellingPrice)}`).join(' · ')}
                                  </p>
                                </JXCard>
                              </div>
                            </>
                            )
}
