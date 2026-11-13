import { useMemo, useState } from 'react'
import { JXAlert, JXButton, JXCard, JXSelect, JXTextField } from '@jacxishippingorg/jx-ui-react'
import { useStore } from '../store/store'
import { dealProfit, vehicleAllInCost, vehicleDirectExpenses, vehiclePartsCost } from '../store/engine'
import { fmtMoney } from '../store/types'
import { Alert, EmptyState, ExportButton, Field, inputCls, KpiCard, Modal, Money, PageHeader, StatusChip, TableScrollHint, usePagination } from '../components/ui'

const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const vehLabel = (v: { stockNumber: string; year: number; make: string; model: string }) => `${v.stockNumber} — ${v.year} ${v.make} ${v.model}`

export default function Sales() {
  const { state, createDeal, finalizeSale, addCustomer } = useStore()
  const { vehicles, customers, deals, sales, expenses, partAllocations, settings, currentUser } = state
  const [statusFilter, setStatusFilter] = useState('All')
  const [selectedId, setSelectedId] = useState<string | null>(deals[0]?.id ?? null)
  const [showNew, setShowNew] = useState(false)
  const [finalizeMsg, setFinalizeMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // New-deal form state
  const [vehicleId, setVehicleId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [newCust, setNewCust] = useState(false)
  const [custName, setCustName] = useState('')
  const [custPhone, setCustPhone] = useState('')
  const [custEmail, setCustEmail] = useState('')
  const [custSalesperson, setCustSalesperson] = useState(currentUser)
  const [sellingPrice, setSellingPrice] = useState('')
  const [discount, setDiscount] = useState('0')
  const [taxes, setTaxes] = useState('0')
  const [fees, setFees] = useState('0')
  const [deposit, setDeposit] = useState('0')
  const [tradeInValue, setTradeInValue] = useState('0')
  const [tradeInDesc, setTradeInDesc] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('Bank transfer')
  const [formError, setFormError] = useState('')

  const sellable = vehicles.filter((v) => v.status === 'Available' || v.status === 'Reserved')
  const filtered = deals.filter((d) => statusFilter === 'All' || d.status === statusFilter)
  const { pageItems, controls } = usePagination(filtered, 10)
  const selected = deals.find((d) => d.id === selectedId) ?? null
  const selVehicle = selected ? vehicles.find((v) => v.id === selected.vehicleId) : undefined
  const selCustomer = selected ? customers.find((c) => c.id === selected.customerId) : undefined
  const selSale = selected?.saleRef ? sales.find((s) => s.ref === selected.saleRef) : undefined

  const profit = useMemo(() => {
    if (!selected || !selVehicle) return null
    const totalCost = vehicleAllInCost(selVehicle, expenses, partAllocations, settings.overheadPerVehicle)
    return {
      totalCost,
      direct: vehicleDirectExpenses(expenses, selVehicle.id),
      parts: vehiclePartsCost(partAllocations, selVehicle.id),
      p: dealProfit(selected, totalCost),
    }
  }, [selected, selVehicle, expenses, partAllocations, settings.overheadPerVehicle])

  const revenue = sales.reduce((s, x) => s + x.sellingPrice, 0)
  const realisedNet = sales.reduce((s, x) => s + x.netProfit, 0)
  const openDeals = deals.filter((d) => d.status === 'Draft' || d.status === 'Negotiation')
  const { pageItems: saleItems, controls: saleControls } = usePagination([...sales].sort((a, b) => b.date.localeCompare(a.date)), 10)

  const resetForm = () => {
    setVehicleId(''); setCustomerId(''); setNewCust(false); setCustName(''); setCustPhone(''); setCustEmail('')
    setSellingPrice(''); setDiscount('0'); setTaxes('0'); setFees('0'); setDeposit('0')
    setTradeInValue('0'); setTradeInDesc(''); setPaymentMethod('Bank transfer'); setFormError('')
  }

  const submitDeal = () => {
    let cid = customerId
    if (newCust) {
      if (!custName.trim()) { setFormError('Enter the new customer name.'); return }
      cid = addCustomer({ name: custName.trim(), phone: custPhone.trim(), email: custEmail.trim(), address: '', preferredContact: 'Phone', budget: num(sellingPrice), leadSource: 'Walk-in', salesperson: custSalesperson || currentUser, notes: '', interestedVehicleIds: vehicleId ? [vehicleId] : [] })
    }
    if (!vehicleId) { setFormError('Select a vehicle (Available or Reserved only).'); return }
    if (!cid) { setFormError('Select or create a customer.'); return }
    if (num(sellingPrice) <= 0) { setFormError('Selling price must be greater than zero.'); return }
    const id = createDeal({
      vehicleId, customerId: cid, salesperson: currentUser,
      sellingPrice: num(sellingPrice), discount: num(discount), taxes: num(taxes), fees: num(fees),
      deposit: num(deposit), tradeInValue: num(tradeInValue), tradeInDesc: tradeInDesc.trim(), paymentMethod,
    })
    setSelectedId(id); setShowNew(false); resetForm(); setFinalizeMsg(null)
  }

  const onFinalize = () => {
    if (!selected) return
    const res = finalizeSale(selected.id)
    setFinalizeMsg(res.ok
      ? { ok: true, text: `Sale finalized — reference ${res.saleRef}. The vehicle is now Sold and the sale is recorded in history below.` }
      : { ok: false, text: res.error ?? 'Finalisation failed.' })
  }

  const formVehicle = vehicles.find((v) => v.id === vehicleId)
  const formCost = formVehicle ? vehicleAllInCost(formVehicle, expenses, partAllocations, settings.overheadPerVehicle) : null
  const formProfit = formVehicle && num(sellingPrice) > 0 ? dealProfit({ sellingPrice: num(sellingPrice), discount: num(discount), taxes: num(taxes), fees: num(fees) }, formCost!) : null

  return (
    <>
      <PageHeader
        title="Deal Desk"
        subtitle="Deals, profitability and finalised sales — all figures from live vehicle costs, never estimates typed in by hand."
        actions={[
          <JXButton key="new" variant="contained" size="sm" onClick={() => { resetForm(); setShowNew(true) }}>+ New deal</JXButton>,
          <ExportButton key="exp" filename="deals.csv" rows={filtered.map((d) => {
            const v = vehicles.find((x) => x.id === d.vehicleId); const c = customers.find((x) => x.id === d.customerId)
            return { ref: d.ref, vehicle: v ? vehLabel(v) : d.vehicleId, customer: c?.name ?? '', sellingPrice: d.sellingPrice, discount: d.discount, status: d.status, saleRef: d.saleRef ?? '' }
          })} />,
        ]}
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Open deals" value={String(openDeals.length)} sub={`${deals.filter((d) => d.status === 'Finalized').length} finalised`} tone="amber" />
        <KpiCard label="Deals total" value={String(deals.length)} sub={`${sales.length} sales recorded`} />
        <KpiCard label="Sales revenue (realised)" value={fmtMoney(revenue)} sub="Sum of finalised sales" tone="emerald" />
        <KpiCard label="Realised net profit" value={fmtMoney(realisedNet)} sub="From finalised sales only" tone="emerald" />
      </div>

      {finalizeMsg && (
        <div className="mb-4"><Alert severity={finalizeMsg.ok ? 'success' : 'error'} title={finalizeMsg.ok ? 'Sale finalised' : 'Cannot finalise sale'} description={finalizeMsg.text} /></div>
      )}

      <div className="grid gap-5 xl:grid-cols-5">
        {/* Deals table */}
        <div className="xl:col-span-3">
            <JXCard title="Deals" description={`${filtered.length} deal${filtered.length === 1 ? '' : 's'}`}
              className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
              <div className="mb-3 flex flex-wrap gap-2">
                {['All', 'Draft', 'Negotiation', 'Finalized', 'Cancelled'].map((s) => (
                <JXButton key={s} variant={statusFilter === s ? 'contained' : 'outlined'} size="sm" lockWidth={false} onClick={() => setStatusFilter(s)}>{s}</JXButton>
                ))}
              </div>
              {pageItems.length === 0 ? (
                <EmptyState title="No deals match" detail="Change the status filter or create a new deal." />
              ) : (
                  <>
                    <TableScrollHint />
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                          <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            <th className="py-2 pr-2">Ref</th><th className="py-2 pr-2">Vehicle</th><th className="py-2 pr-2">Customer</th><th className="py-2 pr-2 text-right">Price</th><th className="py-2 pr-2">Status</th><th className="py-2" />
                          </tr></thead>
                          <tbody>
                              {
                                pageItems.map((d) => {
                                  const v = vehicles.find((x) => x.id === d.vehicleId)
                                  const c = customers.find((x) => x.id === d.customerId)
                                  return (
                                      <tr key={d.id} className={`border-b border-slate-100 dark:border-slate-700 ${selectedId === d.id ? 'bg-indigo-50 dark:bg-indigo-950/40' : ''}`}>
                                        <td className="py-2 pr-2 font-mono font-semibold">{d.ref}{d.saleRef && <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{d.saleRef}</span>}</td>
                                        <td className="py-2 pr-2">{v ? vehLabel(v) : '—'}</td>
                                        <td className="py-2 pr-2">{c?.name ?? '—'}</td>
                                        <td className="py-2 pr-2 text-right"><Money value={d.sellingPrice - d.discount} /></td>
                                        <td className="py-2 pr-2"><StatusChip value={d.status} /></td>
                                        <td className="py-2 text-right"><JXButton variant="text" size="sm" lockWidth={false} onClick={() => { setSelectedId(d.id); setFinalizeMsg(null) }}>View</JXButton></td>
                                      </tr>
                                      )
                      })}
                                    </tbody>
                  </table>
                        </div>
                        </>
            )}
                        {controls}
                      </JXCard>

                      {/* Sales history */}
                      <div className="mt-5">
                        <JXCard title="Sales history — realised profit" description="Only finalised sales appear here. Profit is the figure recorded at finalisation."
                          className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                          {saleItems.length === 0 ? <EmptyState title="No sales yet" detail="Finalise a deal to record a sale." /> : (
                            <>
                              <TableScrollHint />
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[640px] text-sm">
                                  <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                    <th className="py-2 pr-2">Sale</th><th className="py-2 pr-2">Vehicle</th><th className="py-2 pr-2">Customer</th><th className="py-2 pr-2">Date</th><th className="py-2 pr-2 text-right">Price</th><th className="py-2 pr-2 text-right">Net profit</th><th className="py-2 text-right">Margin</th>
                                  </tr></thead>
                                  <tbody>
                                    {saleItems.map((s) => {
                                      const v = vehicles.find((x) => x.id === s.vehicleId)
                                      const c = customers.find((x) => x.id === s.customerId)
                                      return (
                                        <tr key={s.id} className="border-b border-slate-100 dark:border-slate-700">
                                          <td className="py-2 pr-2 font-mono font-semibold">{s.ref}</td>
                                          <td className="py-2 pr-2">{v ? vehLabel(v) : '—'}</td>
                                          <td className="py-2 pr-2">{c?.name ?? '—'}</td>
                                          <td className="py-2 pr-2">{s.date}</td>
                                          <td className="py-2 pr-2 text-right"><Money value={s.sellingPrice} /></td>
                                          <td className={`py-2 pr-2 text-right font-semibold ${s.netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}><Money value={s.netProfit} /></td>
                                          <td className="py-2 text-right">{s.marginPct.toFixed(1)}%</td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </>
                          )}
                          {saleControls}
                        </JXCard>
                      </div>
                    </div>

                    {/* Deal detail / profitability */}
                    <div className="xl:col-span-2">
                      {!selected || !selVehicle || !profit ? (
                        <EmptyState title="No deal selected" detail="Select a deal from the table to see its cost breakdown and profitability." />
                      ) : (
                        <JXCard
                          title={`${selected.ref} — ${vehLabel(selVehicle)}`}
                          kicker={selected.status === 'Finalized' ? 'Finalised sale' : 'Estimate — not yet finalised'}
                          description={`Customer: ${selCustomer?.name ?? '—'} · Salesperson: ${selected.salesperson} · ${selected.paymentMethod} · Created ${selected.createdAt}${selected.finalizedAt ? ` · Finalised ${selected.finalizedAt}` : ''}`}
                          className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]"
                        >
                          <div className="mb-3 flex flex-wrap gap-2">
                            <StatusChip value={selected.status} />
                            <StatusChip value={selVehicle.status} />
                            {selected.saleRef && <span className="font-mono text-sm font-semibold text-indigo-600 dark:text-indigo-400">{selected.saleRef}</span>}
                          </div>

                          <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
                            {selected.status === 'Finalized' && selSale ? 'Finalised result (recorded sale)' : 'Profitability estimate'}
                          </h3>
                          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                            {selected.status === 'Finalized'
                              ? 'These are the realised figures recorded when the sale was finalised. Cost is the vehicle all-in cost at that time.'
                              : 'Estimate only — based on the current all-in vehicle cost and the deal terms. It changes if costs, price or discount change, and is not a realised result until the sale is finalised.'}
                          </p>

                          <dl className="space-y-1.5 text-sm">
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Purchase price</dt><dd><Money value={selVehicle.purchasePrice} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Auction fees</dt><dd><Money value={selVehicle.auctionFees} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Transport cost</dt><dd><Money value={selVehicle.transportCost} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Direct expenses (recon / repairs)</dt><dd><Money value={profit.direct} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Parts (FIFO allocations)</dt><dd><Money value={profit.parts} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Allocated overhead</dt><dd><Money value={settings.overheadPerVehicle} /></dd></div>
                            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold dark:border-slate-700"><dt>Total cost (all-in)</dt><dd><Money value={profit.totalCost} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Selling price</dt><dd><Money value={selected.sellingPrice} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Discount</dt><dd>−<Money value={selected.discount} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Net selling price</dt><dd><Money value={selected.sellingPrice - selected.discount} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Selling expenses (taxes {fmtMoney(selected.taxes)} + fees {fmtMoney(selected.fees)})</dt><dd><Money value={profit.p.sellingExpenses} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Deposit paid</dt><dd><Money value={selected.deposit} /></dd></div>
                            {selected.tradeInValue > 0 && <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Trade-in: {selected.tradeInDesc || '—'}</dt><dd><Money value={selected.tradeInValue} /></dd></div>}
                            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold dark:border-slate-700"><dt>Gross profit</dt><dd><Money value={selSale?.grossProfit ?? profit.p.grossProfit} /></dd></div>
                            <div className={`flex justify-between font-semibold ${(selSale?.netProfit ?? profit.p.netProfit) >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}><dt>Net profit</dt><dd><Money value={selSale?.netProfit ?? profit.p.netProfit} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Margin (net ÷ net selling)</dt><dd>{(selSale?.marginPct ?? profit.p.marginPct).toFixed(1)}%</dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">ROI (net ÷ total cost)</dt><dd>{profit.p.roiPct.toFixed(1)}%</dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Break-even price</dt><dd><Money value={profit.p.breakEven} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Vehicle minimum price</dt><dd><Money value={selVehicle.minPrice} /></dd></div>
                            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">Asking price</dt><dd><Money value={selVehicle.askingPrice} /></dd></div>
                          </dl>

                          {selected.status !== 'Finalized' && selected.status !== 'Cancelled' && (
                            <div className="mt-4">
                              <JXAlert severity={(selected.sellingPrice - selected.discount) < profit.p.breakEven ? 'warning' : 'info'} title={(selected.sellingPrice - selected.discount) < profit.p.breakEven ? 'Below break-even' : 'Ready to finalise?'} description={(selected.sellingPrice - selected.discount) < profit.p.breakEven ? `Net selling price is below the break-even price of ${fmtMoney(profit.p.breakEven)}. Finalising will record a loss.` : `Finalising marks ${selVehicle.stockNumber} Sold, records the sale and its profit, and moves the customer's lead to Sold.`} />
                              <div className="mt-3"><JXButton variant="contained" color="success" lockWidth={false} onClick={onFinalize}>Finalize sale</JXButton></div>
                              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Finalising validates in the store: the vehicle must be Available or Reserved and not already sold.</p>
                            </div>
                          )}
                          {selected.status === 'Finalized' && selSale && (
                <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Recorded sale {selSale.ref} on {selSale.date}: price <Money value={selSale.sellingPrice} />, total cost <Money value={selSale.totalCost} />, gross <Money value={selSale.grossProfit} />, net <Money value={selSale.netProfit} />.</p>
                          )}
                        </JXCard>
                      )}
                    </div>
                  </div>

                {showNew && (
                  <Modal title="New deal" onClose={() => setShowNew(false)} wide>
                    {formError && <div className="mb-3"><Alert severity="error" title="Check the form" description={formError} /></div>}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <JXSelect label="Vehicle — Available / Reserved only" className="jx-select-field jx-field-select" searchable placeholder="Select a vehicle" value={vehicleId} onChange={setVehicleId}
                        options={sellable.map((v) => ({ id: v.id, label: `${vehLabel(v)} · ${v.status} · asking ${fmtMoney(v.askingPrice)}` }))} />
                      <Field label="Salesperson">
                        <input className={inputCls} value={currentUser} disabled />
                      </Field>
                        <div className="flex flex-wrap gap-2 sm:col-span-2">
                          <JXButton variant={newCust ? 'contained' : 'outlined'} size="sm" lockWidth={false} onClick={() => setNewCust(false)}>Existing customer</JXButton>
                          <JXButton variant={newCust ? 'outlined' : 'contained'} size="sm" lockWidth={false} onClick={() => setNewCust(true)}>Create new customer</JXButton>
                        </div>
                        {newCust ? (
                          <>
                            <Field label="Customer name *"><JXTextField className="jx-text-field" label="" value={custName} onChange={setCustName} placeholder="Full name" /></Field>
                            <Field label="Phone"><JXTextField className="jx-text-field" label="" value={custPhone} onChange={setCustPhone} placeholder="+971 …" /></Field>
                            <Field label="Email"><JXTextField className="jx-text-field" label="" value={custEmail} onChange={setCustEmail} placeholder="name@example.com" /></Field>
                            <Field label="Salesperson"><JXTextField className="jx-text-field" label="" value={custSalesperson} onChange={setCustSalesperson} /></Field>
                          </>
                        ) : (
                          <div className="sm:col-span-2">
                            <JXSelect label="Customer" className="jx-select-field jx-field-select" searchable placeholder="Select a customer" value={customerId} onChange={setCustomerId}
                              options={customers.map((c) => ({ id: c.id, label: `${c.name} · budget ${fmtMoney(c.budget)} · ${c.salesperson}` }))} />
                          </div>
                        )}
                        <Field label="Selling price *"><input className={inputCls} type="number" min="0" step="0.01" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} placeholder="e.g. 25400" /></Field>
                        <Field label="Discount"><input className={inputCls} type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
                        <Field label="Taxes"><input className={inputCls} type="number" min="0" step="0.01" value={taxes} onChange={(e) => setTaxes(e.target.value)} /></Field>
                        <Field label="Fees"><input className={inputCls} type="number" min="0" step="0.01" value={fees} onChange={(e) => setFees(e.target.value)} /></Field>
                        <Field label="Deposit"><input className={inputCls} type="number" min="0" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></Field>
                        <Field label="Trade-in value"><input className={inputCls} type="number" min="0" step="0.01" value={tradeInValue} onChange={(e) => setTradeInValue(e.target.value)} /></Field>
                        <Field label="Trade-in description" hint="Vehicle offered in part-exchange, if any"><JXTextField className="jx-text-field" label="" value={tradeInDesc} onChange={setTradeInDesc} placeholder="e.g. 2015 Corolla, 120k km" /></Field>
                        <JXSelect label="Payment method" className="jx-select-field jx-field-select" value={paymentMethod} onChange={setPaymentMethod} options={['Bank transfer', 'Cash', 'Finance', 'Card'].map((m) => ({ id: m, label: m }))} />
                      </div>
                      {formVehicle && formCost !== null && (
                          <div className="mt-4 rounded-[var(--radius-control)] bg-slate-50 p-3 text-sm dark:bg-slate-900">
                            <p className="font-semibold">Live estimate for {vehLabel(formVehicle)}</p>
                            <p className="text-slate-600 dark:text-slate-300">All-in cost <Money value={formCost} /> · minimum price <Money value={formVehicle.minPrice} />
                              {formProfit && <> · estimated net profit <Money value={formProfit.netProfit} /> ({formProfit.marginPct.toFixed(1)}% margin) · break-even <Money value={formProfit.breakEven} /></>}
                            </p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Estimate only — final figures are fixed when the sale is finalised.</p>
                          </div>
          )}
                          <div className="mt-5 flex flex-wrap justify-end gap-2">
                            <JXButton variant="outlined" onClick={() => setShowNew(false)}>Cancel</JXButton>
                            <JXButton variant="contained" onClick={submitDeal}>Create deal (Draft)</JXButton>
                          </div>
                        </Modal>
                      )}
                    </>
                    )
}
