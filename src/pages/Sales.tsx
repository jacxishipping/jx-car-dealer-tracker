import ResponsiveTable from '../components/ResponsiveTable'
import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { AppTextField as JXTextField } from "../components/AppTextField"
import { useStore } from '../store/store'
import { dealProfit, vehicleAllInCost, vehicleDirectExpenses, vehiclePartsCost } from '../store/engine'
import { fmtMoney, type Deal, type DocRecord, type Vehicle } from '../store/types'
import { can } from '../lib/permissions'
import { Alert, EmptyState, ExportButton, Field, inputCls, KpiCard, Money, PageHeader, StatusChip, TableScrollHint, usePagination } from '../components/ui'

import {JXAlert, JXButton, JXCard, JXNumberField, JXSelect} from '../components/JXUI'
import { WorkflowPage, type WorkflowStep } from '../components/WorkflowPage'
const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const vehLabel = (v: { stockNumber: string; year: number; make: string; model: string }) => `${v.stockNumber} — ${v.year} ${v.make} ${v.model}`
const todayIso = () => new Date().toISOString().slice(0, 10)

function customerHasValidId(documents: DocRecord[], customerId: string) {
  const today = todayIso()
  return documents.some((d) =>
    d.entityType === 'Customer' &&
    d.entityId === customerId &&
    /id|licen[cs]e/i.test(d.type) &&
    (!d.expiresAt || d.expiresAt > today))
}

function nextStockNumber(vehicles: { stockNumber: string }[]) {
  const nums = vehicles.map((v) => Number(v.stockNumber.replace(/\D/g, ''))).filter((n) => Number.isFinite(n) && n > 0)
  return `CDT-${(nums.length ? Math.max(...nums) : 100) + 1}`
}

function tradeInVehicle(deal: Deal, vehicles: Vehicle[], seller: string): Omit<Vehicle, 'id' | 'createdAt'> {
  const desc = deal.tradeInDesc.trim()
  const yearMatch = desc.match(/\b(19|20)\d{2}\b/)
  const year = yearMatch ? Number(yearMatch[0]) : new Date().getFullYear()
  const words = desc.replace(yearMatch?.[0] ?? '', '').trim().split(/\s+/).filter(Boolean)
  const vin = (`TI${deal.ref.replace(/[^A-Za-z0-9]/g, '')}${Date.now().toString(36)}XXXXXXXXXXXXXXX`).toUpperCase().slice(0, 17)
  return {
    stockNumber: nextStockNumber(vehicles),
    vin,
    year,
    make: words[0] || 'Trade-in',
    model: words.slice(1).join(' ') || 'Vehicle',
    trim: '',
    extColor: '',
    intColor: '',
    mileage: 0,
    transmission: 'Automatic',
    engine: '',
    fuel: 'Petrol',
    drivetrain: '',
    bodyType: '',
    condition: 'Fair',
    titleStatus: 'Missing',
    status: 'Received',
    purchaseDate: todayIso(),
    purchaseSource: 'Trade-in',
    purchasePrice: deal.tradeInValue,
    auctionFees: 0,
    transportCost: 0,
    askingPrice: deal.tradeInValue,
    minPrice: deal.tradeInValue,
    photos: [],
    notes: `Trade-in on ${deal.ref} from ${seller}${desc ? ` — ${desc}` : ''}.`,
  }
}

export default function Sales() {
  const { state, createDeal, finalizeSale, addCustomer, addVehicle, recordPurchase } = useStore()
  const location = useLocation()
  const navigate = useNavigate()
  const newPage = location.pathname.endsWith('/sales/new')
  const [createStep, setCreateStep] = useState(0)
  const { vehicles, customers, deals, sales, expenses, partAllocations, settings, documents, currentUser, currentRole } = state
  const canCreateDeal = can(currentRole, 'deal.create')
  const canFinalizeSale = can(currentRole, 'sale.finalize')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selectedId, setSelectedId] = useState<string | null>(() => (location.state as { createdDealId?: string } | null)?.createdDealId ?? deals[0]?.id ?? null)
  const [finalizeMsg, setFinalizeMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // New-deal form state
  const dealQuery = new URLSearchParams(location.search)
  const linkedVehicleId = dealQuery.get('vehicleId') ?? ''
  const linkedCustomerId = dealQuery.get('customerId') ?? ''
  const linkedOffer = dealQuery.get('amount') ?? dealQuery.get('offerAmount') ?? ''
  const [vehicleId, setVehicleId] = useState(vehicles.some((v) => v.id === linkedVehicleId) ? linkedVehicleId : '')
  const [customerId, setCustomerId] = useState(customers.some((c) => c.id === linkedCustomerId) ? linkedCustomerId : '')
  const [newCust, setNewCust] = useState(false)
  const [custName, setCustName] = useState('')
  const [custPhone, setCustPhone] = useState('')
  const [custEmail, setCustEmail] = useState('')
  const [custSalesperson, setCustSalesperson] = useState(currentUser)
  const [sellingPrice, setSellingPrice] = useState(Number(linkedOffer) > 0 ? linkedOffer : '')
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
    if (!vehicleId) { setFormError('Select a vehicle (Available or Reserved only).'); return }
    if (!newCust && !customerId) { setFormError('Select a customer.'); return }
    if (newCust && !custName.trim()) { setFormError('Enter the new customer name.'); return }
    if (num(sellingPrice) <= 0) { setFormError('Selling price must be greater than zero.'); return }
    if ([discount, taxes, fees, deposit, tradeInValue].some((amount) => !Number.isFinite(Number(amount)) || Number(amount) < 0)) {
      setFormError('Discount, taxes, fees, deposit, and trade-in value must be zero or greater.')
      return
    }
    let cid = customerId
    if (newCust) {
      cid = addCustomer({ name: custName.trim(), phone: custPhone.trim(), email: custEmail.trim(), address: '', preferredContact: 'Phone', budget: num(sellingPrice), leadSource: 'Walk-in', salesperson: custSalesperson || currentUser, notes: '', interestedVehicleIds: vehicleId ? [vehicleId] : [] })
    }
    const id = createDeal({
      vehicleId, customerId: cid, salesperson: currentUser,
      sellingPrice: num(sellingPrice), discount: num(discount), taxes: num(taxes), fees: num(fees),
      deposit: num(deposit), tradeInValue: num(tradeInValue), tradeInDesc: tradeInDesc.trim(), paymentMethod,
    })
    setSelectedId(id); resetForm(); setFinalizeMsg(null)
    navigate('/sales', { replace: true, state: { createdDealId: id } })
  }

  const onFinalize = () => {
    if (!selected) return
    if (!canFinalizeSale) {
      setFinalizeMsg({ ok: false, text: 'Your role cannot finalise a sale.' })
      return
    }
    if (!selVehicle || !profit) {
      setFinalizeMsg({ ok: false, text: 'This deal is missing its vehicle, so it cannot be finalised.' })
      return
    }
    if (selVehicle.titleStatus === 'Missing' || selVehicle.titleStatus === 'Lien') {
      setFinalizeMsg({ ok: false, text: `Cannot finalise ${selected.ref}: ${selVehicle.stockNumber} title status is ${selVehicle.titleStatus}. Resolve the title before this sale can close.` })
      return
    }
    if (!customerHasValidId(documents, selected.customerId)) {
      const name = selCustomer?.name ?? 'This customer'
      setFinalizeMsg({ ok: false, text: `Cannot finalise ${selected.ref}: ${name} has no ID or license on file that is still valid. Add a customer document whose type includes ID or License, with no expiry date or an expiry in the future.` })
      return
    }
    const netPrice = selected.sellingPrice - selected.discount
    const belowMin = netPrice < selVehicle.minPrice
    const belowBreakEven = netPrice < profit.p.breakEven
    let priceOverride = false
    if (belowMin || belowBreakEven) {
      const why = [
        belowMin ? `below the vehicle minimum of ${fmtMoney(selVehicle.minPrice)}` : '',
        belowBreakEven ? `below break-even of ${fmtMoney(profit.p.breakEven)}` : '',
      ].filter(Boolean).join(' and ')
      if (currentRole !== 'Owner' && currentRole !== 'Admin') {
        setFinalizeMsg({ ok: false, text: `Net price ${fmtMoney(netPrice)} is ${why}. Only an Owner or Admin can confirm an override.` })
        return
      }
      const confirmed = window.confirm(`Net price ${fmtMoney(netPrice)} is ${why}. Confirm override and finalise ${selected.ref}?`)
      if (!confirmed) {
        setFinalizeMsg({ ok: false, text: 'Finalisation cancelled. The price override was not confirmed.' })
        return
      }
      priceOverride = true
    }
    const floorplanBalance = selVehicle.floorplanBalance ?? 0
    if (floorplanBalance > 0) {
      const curtailment = selVehicle.curtailmentDate ? ` Curtailment date: ${selVehicle.curtailmentDate}.` : ''
      const payoffConfirmed = window.confirm(`Floorplan payoff reminder: ${selVehicle.stockNumber} still has ${fmtMoney(floorplanBalance)} outstanding.${curtailment}\n\nConfirm the lender will be paid off, then finalise this sale?`)
      if (!payoffConfirmed) {
        setFinalizeMsg({ ok: false, text: 'Finalisation cancelled. Confirm the floorplan payoff before closing this sale.' })
        return
      }
    }
    const res = finalizeSale(selected.id, { priceOverride })
    if (!res.ok) {
      setFinalizeMsg({ ok: false, text: res.error ?? 'Finalisation failed.' })
      return
    }
    let tradeNote = ''
    if (selected.tradeInValue > 0) {
      const seller = selCustomer?.name ?? 'Trade-in customer'
      const inbound = tradeInVehicle(selected, vehicles, seller)
      const purchased = recordPurchase({
        vehicleId: '',
        seller,
        auction: 'Trade-in',
        purchaseDate: inbound.purchaseDate,
        vehiclePrice: inbound.purchasePrice,
        buyerFees: 0,
        auctionFees: 0,
        taxes: 0,
        transportEstimate: 0,
        paymentMethod: 'Trade-in',
        paymentStatus: 'Paid',
        documents: selected.ref,
      }, inbound)
      const created = purchased.ok ? purchased : addVehicle(inbound)
      tradeNote = created.ok
        ? ` Trade-in ${inbound.stockNumber} (${inbound.year} ${inbound.make} ${inbound.model}) was added to inventory at ${fmtMoney(inbound.purchasePrice)} with source Trade-in.`
        : ` The sale is recorded, but the trade-in vehicle was not created: ${created.error ?? 'unknown error'}.`
    }
    setFinalizeMsg({
      ok: true,
      text: `Sale finalized — reference ${res.saleRef}. The vehicle is now Sold and the sale is recorded in history below.${tradeNote}`,
    })
  }

  const formVehicle = vehicles.find((v) => v.id === vehicleId)
  const formCost = formVehicle ? vehicleAllInCost(formVehicle, expenses, partAllocations, settings.overheadPerVehicle) : null
  const formProfit = formVehicle && num(sellingPrice) > 0 ? dealProfit({ sellingPrice: num(sellingPrice), discount: num(discount), taxes: num(taxes), fees: num(fees) }, formCost!) : null

  const dealSteps: WorkflowStep[] = [
    { id: 'vehicle', label: 'Vehicle', description: 'Select an available or reserved vehicle' },
    { id: 'customer', label: 'Customer', description: 'Choose a customer or add a new one' },
    { id: 'terms', label: 'Terms', description: 'Set the price and review profitability' },
  ]
  const validateDealStep = () => {
    setFormError('')
    if (createStep === 0 && !vehicleId) { setFormError('Select an available or reserved vehicle to continue.'); return false }
    if (createStep === 1 && (newCust ? !custName.trim() : !customerId)) { setFormError(newCust ? 'Enter the customer name to continue.' : 'Select a customer to continue.'); return false }
    if (createStep === 2) {
      const amounts = [sellingPrice, discount, taxes, fees, deposit, tradeInValue]
      if (num(sellingPrice) <= 0 || amounts.some((amount) => Number(amount) < 0)) { setFormError('Selling price must be above zero; other amounts must be zero or greater.'); return false }
    }
    return true
  }
  const openNewDeal = () => { resetForm(); setCreateStep(0); navigate('/sales/new', { state: { from: `${location.pathname}${location.search}` } }) }
  const cancelNewDeal = () => {
    const from = (location.state as { from?: string } | null)?.from
    navigate(from && from.startsWith('/sales') && !from.endsWith('/new') ? from : '/sales', { replace: true })
  }

  if (newPage && !canCreateDeal) return (
    <>
      <PageHeader title="New deal" subtitle="Creating a deal requires the deal desk permission." />
      <Alert severity="error" title="You cannot create deals" description="Your role does not include deal.create. An Owner or Admin can grant access." />
      <div className="mt-4"><JXButton variant="outlined" lockWidth={false} onClick={() => navigate('/sales')}>Back to deals</JXButton></div>
    </>
  )

  if (newPage) return <WorkflowPage title="New deal" subtitle="Create a draft deal, then continue to finalisation from the deal review." steps={dealSteps} step={createStep} onStepChange={setCreateStep} onCancel={cancelNewDeal} onBack={() => setCreateStep((current) => Math.max(0, current - 1))} onNext={() => { if (validateDealStep()) setCreateStep((current) => Math.min(dealSteps.length - 1, current + 1)) }} onSubmit={submitDeal} submitLabel="Create deal draft" error={formError}>
    {createStep === 0 && <section aria-labelledby="deal-vehicle-title"><h2 id="deal-vehicle-title" className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Choose a vehicle</h2><div className="grid gap-4 sm:grid-cols-2"><JXSelect label="Vehicle · Available / Reserved" className="jx-select-field jx-field-select sm:col-span-2" searchable placeholder="Select a vehicle" value={vehicleId} onChange={setVehicleId} options={sellable.map((v) => ({ id: v.id, label: `${vehLabel(v)} · ${v.status} · asking ${fmtMoney(v.askingPrice)}` }))} /><Field label="Salesperson"><input className={inputCls} value={currentUser} disabled /></Field>{formVehicle && <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="font-semibold text-slate-900 dark:text-white">{vehLabel(formVehicle)}</p><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Asking <Money value={formVehicle.askingPrice} /> · Minimum <Money value={formVehicle.minPrice} /></p></div>}</div></section>}
    {createStep === 1 && <section aria-labelledby="deal-customer-title"><h2 id="deal-customer-title" className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Choose a customer</h2><div className="mb-4 flex flex-wrap gap-2"><JXButton type="button" variant={newCust ? 'outlined' : 'contained'} lockWidth={false} onClick={() => setNewCust(false)}>Existing customer</JXButton><JXButton type="button" variant={newCust ? 'contained' : 'outlined'} lockWidth={false} onClick={() => setNewCust(true)}>Create customer with deal</JXButton></div>{newCust ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Customer name *"><JXTextField className="jx-text-field" label="" value={custName} onChange={setCustName} placeholder="Full name" /></Field><Field label="Phone"><JXTextField className="jx-text-field" label="" value={custPhone} onChange={setCustPhone} placeholder="+971 …" /></Field><Field label="Email"><JXTextField className="jx-text-field" label="" value={custEmail} onChange={setCustEmail} placeholder="name@example.com" /></Field><Field label="Salesperson"><JXTextField className="jx-text-field" label="" value={custSalesperson} onChange={setCustSalesperson} /></Field></div> : <JXSelect label="Customer" className="jx-select-field jx-field-select" searchable placeholder="Select a customer" value={customerId} onChange={setCustomerId} options={customers.map((c) => ({ id: c.id, label: `${c.name} · budget ${fmtMoney(c.budget)} · ${c.salesperson}` }))} />}</section>}
    {createStep === 2 && <section aria-labelledby="deal-terms-title"><h2 id="deal-terms-title" className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Price and deal terms</h2><div className="grid gap-4 sm:grid-cols-2">{([['sellingPrice','Selling price (USD) *'],['discount','Discount (USD)'],['taxes','Taxes (USD)'],['fees','Fees (USD)'],['deposit','Deposit (USD)'],['tradeInValue','Trade-in value (USD)']] as const).map(([key,label]) => { const values = { sellingPrice, discount, taxes, fees, deposit, tradeInValue }; const setValues = { sellingPrice:setSellingPrice, discount:setDiscount, taxes:setTaxes, fees:setFees, deposit:setDeposit, tradeInValue:setTradeInValue }; return <Field key={key} label={label}><JXNumberField label="" value={num(values[key])} min={0} max={1_000_000_000} step={100} unit="USD" onChange={(value) => setValues[key](String(value))} /></Field> })}<Field label="Trade-in description"><JXTextField className="jx-text-field" label="" value={tradeInDesc} onChange={setTradeInDesc} placeholder="Optional vehicle offered in part-exchange" /></Field><JXSelect label="Payment method" className="jx-select-field jx-field-select" value={paymentMethod} onChange={setPaymentMethod} options={['Bank transfer', 'Cash', 'Finance', 'Card'].map((m) => ({ id: m, label: m }))} /></div>{formVehicle && formCost !== null && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-900"><p className="font-semibold">Live estimate · {vehLabel(formVehicle)}</p><p className="mt-1 text-slate-600 dark:text-slate-300">All-in cost <Money value={formCost} /> · minimum price <Money value={formVehicle.minPrice} />{formProfit && <> · estimated net profit <Money value={formProfit.netProfit} /> ({formProfit.marginPct.toFixed(1)}% margin) · break-even <Money value={formProfit.breakEven} /></>}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Estimate only. Final figures are fixed when a manager finalises the sale.</p></div>}</section>}
  </WorkflowPage>

  const buyerOrder = selected && selVehicle && selected.status === 'Finalized' ? (
    <section id="buyer-order" className="hidden bg-white p-8 text-black print:block">
      <style>{`@media print { body * { visibility: hidden !important; } #buyer-order, #buyer-order * { visibility: visible !important; } #buyer-order { position: absolute; left: 0; top: 0; display: block !important; width: 100%; background: white; color: black; } }`}</style>
      <p className="text-xs uppercase tracking-wide">{settings.orgName}</p>
      <h1 className="mt-1 text-2xl font-bold">Buyer order {selected.saleRef ?? selected.ref}</h1>
      <p className="mt-1 text-sm">Deal {selected.ref}{selected.finalizedAt ? ` · ${selected.finalizedAt}` : ''} · {selected.salesperson} · {selected.paymentMethod}</p>
      <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
        <div>
          <h2 className="font-semibold">Buyer</h2>
          <p>{selCustomer?.name ?? '—'}</p>
          <p>{selCustomer?.phone}</p>
          <p>{selCustomer?.email}</p>
          <p>{selCustomer?.address}</p>
        </div>
        <div>
          <h2 className="font-semibold">Vehicle</h2>
          <p>{vehLabel(selVehicle)}</p>
          <p>VIN {selVehicle.vin}</p>
          <p>{selVehicle.mileage.toLocaleString()} miles · {selVehicle.titleStatus} title</p>
        </div>
      </div>
      <dl className="mt-6 space-y-1 text-sm">
        <div className="flex justify-between"><dt>Selling price</dt><dd>{fmtMoney(selected.sellingPrice)}</dd></div>
        <div className="flex justify-between"><dt>Discount</dt><dd>{fmtMoney(selected.discount)}</dd></div>
        <div className="flex justify-between font-semibold"><dt>Net price</dt><dd>{fmtMoney(selected.sellingPrice - selected.discount)}</dd></div>
        <div className="flex justify-between"><dt>Taxes</dt><dd>{fmtMoney(selected.taxes)}</dd></div>
        <div className="flex justify-between"><dt>Fees</dt><dd>{fmtMoney(selected.fees)}</dd></div>
        <div className="flex justify-between"><dt>Deposit</dt><dd>{fmtMoney(selected.deposit)}</dd></div>
        {selected.tradeInValue > 0 && <div className="flex justify-between"><dt>Trade-in{selected.tradeInDesc ? ` (${selected.tradeInDesc})` : ''}</dt><dd>{fmtMoney(selected.tradeInValue)}</dd></div>}
        <div className="flex justify-between border-t border-black pt-1 font-semibold"><dt>Balance</dt><dd>{fmtMoney(Math.max(0, selected.sellingPrice - selected.discount - selected.deposit - selected.tradeInValue))}</dd></div>
      </dl>
      {selSale && <p className="mt-4 text-xs">Recorded sale {selSale.ref}. Net profit {fmtMoney(selSale.netProfit)}.</p>}
    </section>
  ) : null

  return (
    <>
      {buyerOrder}
      <div className="print:hidden">
      <PageHeader
        title="Deal Desk"
        subtitle="Deals, profitability and finalised sales — all figures from live vehicle costs, never estimates typed in by hand."
        actions={[
          canCreateDeal ? <JXButton key="new" variant="contained" size="sm" onClick={openNewDeal}>+ New deal</JXButton> : null,
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
        <div className="mb-4">
          <Alert severity={finalizeMsg.ok ? 'success' : 'error'} title={finalizeMsg.ok ? 'Sale finalised' : 'Cannot finalise sale'} description={finalizeMsg.text} />
          {finalizeMsg.ok && selected?.status === 'Finalized' && (
            <div className="mt-2"><JXButton variant="outlined" size="sm" lockWidth={false} onClick={() => window.print()}>Print buyer order</JXButton></div>
          )}
        </div>
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
                <EmptyState
                  kind={deals.length === 0 ? 'first-run' : 'filtered'}
                  title={deals.length === 0 ? 'No deals yet' : 'No deals match'}
                  detail={deals.length === 0 ? 'Create a draft deal to start quoting and finalising sales.' : 'Change the status filter or create a new deal.'}
                  action={canCreateDeal ? <JXButton variant="contained" size="sm" lockWidth={false} onClick={openNewDeal}>+ New deal</JXButton> : undefined}
                />
              ) : (
                  <>
                    <TableScrollHint />
                    <div className="overflow-x-auto">
                      <ResponsiveTable><table className="w-full min-w-[640px] text-sm">
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
                  </table></ResponsiveTable>
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
                                <ResponsiveTable><table className="w-full min-w-[640px] text-sm">
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
                                </table></ResponsiveTable>
                              </div>
                            </>
                          )}
                          {saleControls}
                        </JXCard>
                      </div>
                    </div>

                    {/* Deal detail / profitability — only when a deal is selected */}
                    <div className="xl:col-span-2">
                      {selected && selVehicle && profit ? (
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
                              {(() => {
                                const netPrice = selected.sellingPrice - selected.discount
                                const belowMin = netPrice < selVehicle.minPrice
                                const belowBreakEven = netPrice < profit.p.breakEven
                                const titleBlocked = selVehicle.titleStatus === 'Missing' || selVehicle.titleStatus === 'Lien'
                                const idBlocked = !customerHasValidId(documents, selected.customerId)
                                return (
                                  <>
                                    <JXAlert severity={belowMin || belowBreakEven ? 'warning' : 'info'} title={belowMin || belowBreakEven ? 'Price needs an override' : 'Ready to finalise?'} description={belowMin || belowBreakEven ? `Net price ${fmtMoney(netPrice)} is ${belowMin ? `below the minimum of ${fmtMoney(selVehicle.minPrice)}` : ''}${belowMin && belowBreakEven ? ' and ' : ''}${belowBreakEven ? `below break-even of ${fmtMoney(profit.p.breakEven)}` : ''}. ${currentRole === 'Owner' || currentRole === 'Admin' ? 'Finalising will ask you to confirm the override.' : 'Only an Owner or Admin can confirm this override.'}` : `Finalising marks ${selVehicle.stockNumber} Sold, records the sale and its profit, and moves the customer's lead to Sold.`} />
                                    {(selVehicle.floorplanBalance ?? 0) > 0 && <div className="mt-3"><Alert severity="warning" title="Floorplan still open" description={`Pay off ${fmtMoney(selVehicle.floorplanBalance ?? 0)} before finalising${selVehicle.curtailmentDate ? ` (curtailment ${selVehicle.curtailmentDate})` : ''}. Finalise asks you to confirm the payoff.`} /></div>}
                                    {titleBlocked && <div className="mt-3"><Alert severity="error" title="Title blocks this sale" description={`${selVehicle.stockNumber} title status is ${selVehicle.titleStatus}. Resolve the title before finalising.`} /></div>}
                                    {idBlocked && <div className="mt-3"><Alert severity="error" title="Customer ID required" description={`${selCustomer?.name ?? 'This customer'} has no ID or license document that is still valid. Add one before finalising.`} /></div>}
                                    <div className="mt-3">
                                      {canFinalizeSale
                                        ? <JXButton variant="contained" color="success" lockWidth={false} onClick={onFinalize}>Finalize sale</JXButton>
                                        : <p className="text-sm text-slate-600 dark:text-slate-300">Your role cannot finalise sales.</p>}
                                    </div>
                                  </>
                                )
                              })()}
                              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Finalising validates in the store: the vehicle must be Available or Reserved and not already sold.</p>
                            </div>
                          )}
                          {selected.status === 'Finalized' && selSale && (
                            <div className="mt-4">
                              <p className="text-xs text-slate-500 dark:text-slate-400">Recorded sale {selSale.ref} on {selSale.date}: price <Money value={selSale.sellingPrice} />, total cost <Money value={selSale.totalCost} />, gross <Money value={selSale.grossProfit} />, net <Money value={selSale.netProfit} />.</p>
                              <div className="mt-3"><JXButton variant="outlined" size="sm" lockWidth={false} onClick={() => window.print()}>Print buyer order</JXButton></div>
                            </div>
                          )}
                        </JXCard>
                      ) : deals.length > 0 ? (
                        <EmptyState title="No deal selected" detail="Select a deal from the table to see its cost breakdown and profitability." />
                      ) : null}
                    </div>
                  </div>
      </div>
                    </>
                    )
}
