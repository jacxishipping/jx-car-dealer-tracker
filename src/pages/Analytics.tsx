import { useMemo } from 'react'
import { JXCard } from '@jacxishippingorg/jx-ui-react'
import { useStore } from '../store/store'
import { daysInStock, monthlySeries } from '../store/engine'
import { fmtMoney } from '../store/types'
import { BarChart, Donut, EmptyState, KpiCard, Money, PageHeader } from '../components/ui'

const DONUT_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#0ea5e9', '#f43f5e', '#8b5cf6', '#64748b']

export default function Analytics() {
  const { state } = useStore()

  const series = useMemo(() => monthlySeries(state, 6), [state])
  const totalRevenue = series.reduce((s, m) => s + m.revenue, 0)
  const totalProfit = series.reduce((s, m) => s + m.profit, 0)

  // Sales by salesperson — join each sale to its deal for the salesperson.
  const bySalesperson = useMemo(() => {
    const map = new Map<string, { deals: number; revenue: number; profit: number }>()
    for (const sale of state.sales) {
      const deal = state.deals.find((d) => d.id === sale.dealId)
      const name = deal?.salesperson ?? 'Unassigned'
      const cur = map.get(name) ?? { deals: 0, revenue: 0, profit: 0 }
      cur.deals += 1
      cur.revenue += sale.sellingPrice
      cur.profit += sale.netProfit
      map.set(name, cur)
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [state.sales, state.deals])

  // Inventory by status.
  const statusCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const v of state.vehicles) map.set(v.status, (map.get(v.status) ?? 0) + 1)
    return [...map.entries()].map(([label, value], i) => ({ label, value, color: DONUT_COLORS[i % DONUT_COLORS.length] }))
  }, [state.vehicles])

  // Expenses by category.
  const expensesByCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of state.expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount)
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [state.expenses])
  const totalExpenses = expensesByCategory.reduce((s, e) => s + e.value, 0)
  const maxExpense = Math.max(1, ...expensesByCategory.map((e) => e.value))

  // CRM conversion.
  const leadsByStage = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of state.leads) map.set(l.stage, (map.get(l.stage) ?? 0) + 1)
    return map
  }, [state.leads])
  const soldLeads = leadsByStage.get('Sold') ?? 0
  const lostLeads = leadsByStage.get('Lost') ?? 0
  const closedLeads = soldLeads + lostLeads
  const conversionRate = closedLeads > 0 ? (soldLeads / closedLeads) * 100 : 0
  const activeLeads = state.leads.length - soldLeads - lostLeads
  const avgDaysInStock = state.vehicles.length > 0
    ? Math.round(state.vehicles.reduce((s, v) => s + daysInStock(v), 0) / state.vehicles.length)
    : 0

  const tableCls = 'w-full min-w-[640px] text-sm'
  const thCls = 'border-b border-slate-200 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800'
  const tdCls = 'border-b border-slate-100 px-4 py-2.5 text-slate-700 dark:border-slate-800 dark:text-slate-300'

  return (
    <>
      <PageHeader title="Analytics" subtitle="Every figure below is computed from live state — no hardcoded series." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Revenue (last 6 months)" value={fmtMoney(totalRevenue)} sub={`${state.sales.length} sales in total`} tone="indigo" />
        <KpiCard label="Net profit (last 6 months)" value={fmtMoney(totalProfit)} sub={totalRevenue > 0 ? `${((totalProfit / totalRevenue) * 100).toFixed(1)}% margin` : 'No revenue yet'} tone="emerald" />
        <KpiCard label="CRM conversion (Sold / closed)" value={`${conversionRate.toFixed(1)}%`} sub={`${soldLeads} sold · ${lostLeads} lost · ${activeLeads} still open`} tone="sky" />
        <KpiCard label="Avg days in stock" value={`${avgDaysInStock} days`} sub={`Target hold: ${state.settings.targetHoldDays} days`} tone="amber" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <JXCard title="Revenue & profit — last 6 months" kicker="Monthly series" description="Indigo = revenue, green = net profit, from sales dates."
          className="!rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {series.every((m) => m.revenue === 0 && m.profit === 0)
            ? <EmptyState title="No sales in the last 6 months" detail="Finalise a deal to see revenue and profit here." />
            : (
              <>
                <BarChart data={series.map((m) => ({ label: m.label, value: m.revenue, value2: m.profit }))} />
                <div className="mt-2 flex gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-indigo-600" /> Revenue</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Net profit</span>
                </div>
              </>
            )}
        </JXCard>

        <JXCard title="Inventory by status" kicker="Stock mix" description="All vehicles in the tracker, grouped by current status."
          className="!rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {state.vehicles.length === 0
            ? <EmptyState title="No vehicles" />
            : <Donut segments={statusCounts} total={state.vehicles.length} label="vehicles" />}
        </JXCard>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <JXCard title="Sales by salesperson" kicker="Revenue share" description="Revenue and realised profit per salesperson, from finalised sales."
          className="!rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {bySalesperson.length === 0
            ? <EmptyState title="No sales yet" detail="Finalise a deal to see salesperson results." />
            : (
              <div className="space-y-3">
                {bySalesperson.map((s) => {
                  const max = Math.max(1, ...bySalesperson.map((x) => x.revenue))
                  return (
                    <div key={s.name}>
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-slate-900 dark:text-white">{s.name} <span className="text-slate-400">· {s.deals} {s.deals === 1 ? 'deal' : 'deals'}</span></span>
                        <span className="font-mono"><Money value={s.revenue} /></span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${(s.revenue / max) * 100}%` }} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">Realised net profit <Money value={s.profit} /></p>
                    </div>
                  )
                })}
              </div>
            )}
        </JXCard>

        <JXCard title="Expenses by category" kicker="Where money goes" description="All recorded expenses, direct and overhead, grouped by category."
          className="!rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {expensesByCategory.length === 0
            ? <EmptyState title="No expenses recorded" />
            : (
              <div className="space-y-3">
                {expensesByCategory.map((e) => (
                  <div key={e.label}>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-700 dark:text-slate-300">{e.label}</span>
                      <span className="font-mono"><Money value={e.value} /></span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-2 rounded-full bg-amber-500" style={{ width: `${(e.value / maxExpense) * 100}%` }} />
                    </div>
                  </div>
                ))}
                <p className="border-t border-slate-200 pt-2 text-sm text-slate-500 dark:border-slate-800">Total expenses: <span className="font-mono font-semibold text-slate-900 dark:text-white">{fmtMoney(totalExpenses)}</span></p>
              </div>
            )}
        </JXCard>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <JXCard title="CRM conversion funnel" kicker="Leads by stage" description="Conversion = Sold ÷ (Sold + Lost). Open leads are still in play, not lost."
          className="!rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {state.leads.length === 0
            ? <EmptyState title="No leads" />
            : (
              <div className="space-y-2">
                {['New Lead', 'Contacted', 'Viewing', 'Negotiation', 'Sold', 'Lost'].map((stage) => {
                  const n = leadsByStage.get(stage) ?? 0
                  return (
                    <div key={stage} className="flex items-center gap-3 text-sm">
                      <span className="w-28 text-slate-600 dark:text-slate-300">{stage}</span>
                      <div className="h-2.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-2.5 rounded-full bg-indigo-600" style={{ width: `${state.leads.length > 0 ? (n / state.leads.length) * 100 : 0}%` }} />
                      </div>
                      <span className="w-8 text-right font-mono font-semibold">{n}</span>
                    </div>
                  )
                })}
                <p className="border-t border-slate-200 pt-2 text-sm text-slate-500 dark:border-slate-800">
                  {state.leads.length} leads in total · {soldLeads} sold · {lostLeads} lost · conversion <span className="font-semibold text-slate-900 dark:text-white">{conversionRate.toFixed(1)}%</span>
                </p>
              </div>
            )}
        </JXCard>

        <JXCard title="Salesperson performance" kicker="Deals & realised profit" description="One row per salesperson with finalised sales."
          className="!rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {bySalesperson.length === 0
            ? <EmptyState title="No sales yet" />
            : (
              <div className="overflow-x-auto">
                <table className={tableCls}>
                  <thead><tr><th className={thCls}>Salesperson</th><th className={`${thCls} text-right`}>Deals</th><th className={`${thCls} text-right`}>Revenue</th><th className={`${thCls} text-right`}>Realised profit</th><th className={`${thCls} text-right`}>Avg profit / deal</th></tr></thead>
                  <tbody>
                    {bySalesperson.map((s) => (
                      <tr key={s.name}>
                        <td className={tdCls}>{s.name}</td>
                        <td className={`${tdCls} text-right`}>{s.deals}</td>
                        <td className={`${tdCls} text-right font-mono`}><Money value={s.revenue} /></td>
                        <td className={`${tdCls} text-right font-mono`}><Money value={s.profit} /></td>
                        <td className={`${tdCls} text-right font-mono`}><Money value={s.deals > 0 ? s.profit / s.deals : 0} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </JXCard>
      </div>
    </>
  )
}
