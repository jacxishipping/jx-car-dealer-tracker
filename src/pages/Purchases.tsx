import ResponsiveTable from '../components/ResponsiveTable'
import {JXButton} from '../components/JXUI'
// Purchases — acquisition list + "Record purchase" (recordPurchase atomically
// creates vehicle + purchase + payment/journal + inventory entry).
import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { AppTextField as JXTextField } from "../components/AppTextField"
import { Plus } from 'lucide-react'
import { useStore } from '../store/store'
import { fmtMoney, type Purchase } from '../store/types'
import {
  Alert, EmptyState, ExportButton, Field, inputCls, KpiCard,
  Money, PageHeader, StatusChip, TableScrollHint, usePagination,
} from '../components/ui'
import { JXNumberField, JXSelect } from '../components/JXUI'
import { WorkflowPage, type WorkflowStep } from '../components/WorkflowPage'

const today = () => new Date().toISOString().slice(0, 10)
const CURRENT_YEAR = new Date().getFullYear()
const num = (v: string) => (v === '' ? 0 : Number(v))

export default function Purchases() {
  const { state, recordPurchase } = useStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const newPage = location.pathname.endsWith('/purchases/new') || searchParams.get('new') === '1'
  const [step, setStep] = useState(0)
  const openPurchasePage = () => { setError(null); setStep(0); navigate('/purchases/new', { state: { from: `${location.pathname}${location.search}` } }) }
  const closePurchasePage = () => {
    const from = (location.state as { from?: string } | null)?.from
    navigate(from && from.startsWith('/purchases') && !from.includes('/new') ? from : '/purchases', { replace: true })
    if (searchParams.has('new')) setSearchParams({}, { replace: true })
  }
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(() => (location.state as { purchaseSuccess?: string } | null)?.purchaseSuccess ?? null)
  const [search, setSearch] = useState('')

  const vehicleById = useMemo(() => new Map(state.vehicles.map((v) => [v.id, v])), [state.vehicles])

  const sorted = useMemo(
    () => [...state.purchases].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)),
    [state.purchases],
  )
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((p) => {
      const v = vehicleById.get(p.vehicleId)
      return [p.ref, p.seller, p.auction, p.paymentMethod, p.paymentStatus,
      v?.stockNumber, v?.vin, v?.make, v?.model].join(' ').toLowerCase().includes(q)
    })
  }, [sorted, search, vehicleById])

  const { pageItems, controls } = usePagination(filtered, 10)

  const totalVehicle = state.purchases.reduce((s, p) => s + p.vehiclePrice, 0)
  const totalFees = state.purchases.reduce((s, p) => s + p.buyerFees + p.auctionFees + p.taxes, 0)
  const totalAllIn = totalVehicle + totalFees
  const paidCount = state.purchases.filter((p) => p.paymentStatus === 'Paid').length

  // ---- Record purchase form ----
  const nextStock = useMemo(() => {
    const max = state.vehicles.reduce((m, v) => {
      const n = Number(v.stockNumber.replace(/\D/g, ''))
      return Number.isFinite(n) ? Math.max(m, n) : m
    }, 100)
    return `CDT-${max + 1}`
  }, [state.vehicles])

  const [f, setF] = useState(() => ({
    seller: '', auction: '', source: 'Auction', vin: '', year: String(new Date().getFullYear()),
    make: '', model: '', trim: '', mileage: '', price: '', buyerFees: '', auctionFees: '',
    taxes: '', transportEstimate: '', paymentMethod: 'Bank transfer', paymentStatus: 'Paid',
    purchaseDate: today(), askingPrice: '', minPrice: '',
  }))
  const setText = (k: keyof typeof f, value: string) => setF((prev) => ({ ...prev, [k]: value }))
  const setAmount = (k: 'price' | 'buyerFees' | 'auctionFees' | 'taxes' | 'transportEstimate' | 'askingPrice' | 'minPrice' | 'mileage' | 'year', value: number) => setText(k, String(value))

  const submit = () => {
    setError(null)
    setSuccess(null)
    const vin = f.vin.trim().toUpperCase()
    if (!vin || !f.make.trim() || !f.model.trim() || !f.seller.trim() || !f.price) {
      setError('Seller, VIN, make, model and vehicle price are required.')
      return
    }
    const year = Number(f.year) || new Date().getFullYear()
    const price = num(f.price)
    if (price <= 0 || [f.buyerFees, f.auctionFees, f.taxes, f.transportEstimate, f.askingPrice, f.minPrice, f.mileage].some((value) => value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0))) {
      setError('Enter a vehicle price above zero and non-negative numeric values for costs and prices.')
      setStep(2)
      return
    }
    const purchase: Omit<Purchase, 'id' | 'ref' | 'createdAt'> = {
      vehicleId: '', // assigned by the store
      seller: f.seller.trim(),
      auction: f.auction.trim() || '—',
      purchaseDate: f.purchaseDate || today(),
      vehiclePrice: price,
      buyerFees: num(f.buyerFees),
      auctionFees: num(f.auctionFees),
      taxes: num(f.taxes),
      transportEstimate: num(f.transportEstimate),
      paymentMethod: f.paymentMethod,
      paymentStatus: f.paymentStatus as Purchase['paymentStatus'],
      documents: '',
    }
    const vehicle = {
      stockNumber: nextStock,
      vin,
      year,
      make: f.make.trim(),
      model: f.model.trim(),
      trim: f.trim.trim() || '—',
      extColor: '—', intColor: '—',
      mileage: num(f.mileage),
      transmission: '—', engine: '—', fuel: 'Petrol', drivetrain: '—', bodyType: '—',
      condition: 'Good' as const,
      titleStatus: 'Clean' as const,
      status: 'Purchased' as const,
      purchaseDate: f.purchaseDate || today(),
      purchaseSource: f.source as 'Auction' | 'Wholesale' | 'Private seller' | 'Trade-in' | 'Other dealer',
      purchasePrice: price,
      auctionFees: num(f.auctionFees),
      transportCost: 0,
      askingPrice: f.askingPrice ? num(f.askingPrice) : Math.round(price * 1.25),
      minPrice: f.minPrice ? num(f.minPrice) : Math.round(price * 1.15),
      photos: [],
      notes: `Acquired from ${f.seller.trim()}${f.auction.trim() ? ` (${f.auction.trim()})` : ''}.`,
    }
    const res = recordPurchase(purchase, vehicle)
    if (!res.ok) { setError(res.error ?? 'Could not record the purchase.'); return }
    const successMessage = `Purchase recorded — vehicle ${nextStock} (${year} ${vehicle.make} ${vehicle.model}) created and added to inventory.`
    setSuccess(successMessage)
    setF({ ...f, seller: '', auction: '', vin: '', make: '', model: '', trim: '', mileage: '', price: '', buyerFees: '', auctionFees: '', taxes: '', transportEstimate: '', askingPrice: '', minPrice: '' })
    setStep(0)
    navigate('/purchases', { replace: true, state: { purchaseSuccess: successMessage } })
  }

  const purchaseSteps: WorkflowStep[] = [
    { id: 'source', label: 'Source', description: 'Seller and acquisition source' },
    { id: 'vehicle', label: 'Vehicle', description: 'Identify the vehicle for inventory' },
    { id: 'costs', label: 'Costs', description: 'Enter acquisition costs and payment' },
    { id: 'review', label: 'Review', description: 'Confirm the purchase before posting' },
  ]
  const validatePurchaseStep = () => {
    setError(null)
    if (step === 0 && (!f.seller.trim() || !f.purchaseDate)) { setError('Seller and purchase date are required.'); return false }
    if (step === 1 && (!f.vin.trim() || !f.make.trim() || !f.model.trim() || f.vin.trim().length < 11 || f.vin.trim().length > 17)) {
      setError('Enter a VIN (11–17 characters), make, and model to continue.'); return false
    }
    if (step === 2 && (num(f.price) <= 0 || [f.buyerFees, f.auctionFees, f.taxes, f.transportEstimate, f.askingPrice, f.minPrice].some((value) => value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)))) {
      setError('Vehicle price must be above zero. Optional costs and prices must be zero or greater.'); return false
    }
    return true
  }
  const advancePurchaseStep = () => { if (validatePurchaseStep()) setStep((current) => Math.min(purchaseSteps.length - 1, current + 1)) }

  if (newPage) return (
    <WorkflowPage title={`Record purchase · ${nextStock}`} subtitle="Add the acquisition and its new inventory vehicle in four guided steps." steps={purchaseSteps} step={step} onStepChange={setStep} onCancel={closePurchasePage} onBack={() => setStep((current) => Math.max(0, current - 1))} onNext={advancePurchaseStep} onSubmit={submit} submitLabel="Record purchase" error={error}>
      {step === 0 && <section aria-labelledby="purchase-source-title"><h2 id="purchase-source-title" className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Seller and acquisition</h2><div className="grid gap-4 sm:grid-cols-2">
        <Field label="Seller *"><JXTextField label="" className="jx-text-field" value={f.seller} onChange={(value) => setText('seller', value)} placeholder="e.g. Metro Auto Auction" /></Field>
        <Field label="Auction or lane"><JXTextField label="" className="jx-text-field" value={f.auction} onChange={(value) => setText('auction', value)} placeholder="Optional" /></Field>
        <JXSelect label="Purchase source" className="jx-select-field jx-field-select" value={f.source} options={['Auction', 'Wholesale', 'Private seller', 'Trade-in', 'Other dealer'].map((value) => ({ id: value, label: value }))} onChange={(value) => setText('source', value)} />
        <Field label="Purchase date"><input type="date" className={inputCls} value={f.purchaseDate} onChange={(event) => setText('purchaseDate', event.target.value)} /></Field>
      </div></section>}
      {step === 1 && <section aria-labelledby="purchase-vehicle-title"><h2 id="purchase-vehicle-title" className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">Vehicle identity</h2><p className="mb-4 text-sm text-slate-500 dark:text-slate-400">A unique VIN is required to add this vehicle to inventory.</p><div className="grid gap-4 sm:grid-cols-2">
        <Field label="VIN *" hint={`${f.vin.trim().length}/17 characters`}><JXTextField label="" className="jx-text-field" value={f.vin} onChange={(value) => setText('vin', value.toUpperCase())} placeholder="17-character VIN" maxLength={17} /></Field>
        <Field label="Year"><JXNumberField label="" unit="" value={Number(f.year)} min={1886} max={CURRENT_YEAR + 2} step={1} onChange={(value) => setAmount('year', value)} /></Field>
        <Field label="Make *"><JXTextField label="" className="jx-text-field" value={f.make} onChange={(value) => setText('make', value)} placeholder="e.g. Honda" /></Field>
        <Field label="Model *"><JXTextField label="" className="jx-text-field" value={f.model} onChange={(value) => setText('model', value)} placeholder="e.g. Accord" /></Field>
        <Field label="Trim"><JXTextField label="" className="jx-text-field" value={f.trim} onChange={(value) => setText('trim', value)} placeholder="Optional" /></Field>
        <Field label="Mileage"><JXNumberField label="" value={num(f.mileage)} min={0} max={2_000_000} step={1000} unit="mi" onChange={(value) => setAmount('mileage', value)} /></Field>
      </div></section>}
      {step === 2 && <section aria-labelledby="purchase-costs-title"><h2 id="purchase-costs-title" className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Costs and payment</h2><div className="grid gap-4 sm:grid-cols-2">
        {([['price','Vehicle price (USD) *',100],['buyerFees','Buyer fees (USD)',25],['auctionFees','Auction fees (USD)',25],['taxes','Taxes (USD)',25],['transportEstimate','Transport estimate (USD)',25],['askingPrice','Asking price (USD)',100],['minPrice','Minimum price (USD)',100]] as const).map(([key,label,stepBy]) => <Field key={key} label={label} hint={key === 'askingPrice' ? 'Leave at 0 to use vehicle price × 1.25.' : key === 'minPrice' ? 'Leave at 0 to use vehicle price × 1.15.' : undefined}><JXNumberField label="" value={num(f[key])} min={0} max={1_000_000_000} step={stepBy} unit="USD" onChange={(value) => setAmount(key, value)} /></Field>)}
        <JXSelect label="Payment method" className="jx-select-field jx-field-select" value={f.paymentMethod} options={['Bank transfer', 'Cash', 'Card', 'Floorplan', 'Finance'].map((value) => ({ id: value, label: value }))} onChange={(value) => setText('paymentMethod', value)} />
        <JXSelect label="Payment status" className="jx-select-field jx-field-select" value={f.paymentStatus} options={['Paid', 'Partial', 'Unpaid'].map((value) => ({ id: value, label: value }))} onChange={(value) => setText('paymentStatus', value)} />
      </div></section>}
      {step === 3 && <section aria-labelledby="purchase-review-title"><h2 id="purchase-review-title" className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Review acquisition</h2><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="font-semibold text-slate-900 dark:text-white">Vehicle</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{f.year} {f.make} {f.model} {f.trim}</p><p className="text-sm text-slate-500 dark:text-slate-400">{nextStock} · VIN {f.vin}</p></div><div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="font-semibold text-slate-900 dark:text-white">Purchase</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{f.seller} · {f.purchaseDate} · {f.paymentStatus}</p><p className="mt-2 text-sm">Vehicle price <Money value={num(f.price)} /> · Fees and taxes <Money value={num(f.buyerFees) + num(f.auctionFees) + num(f.taxes)} /></p><p className="mt-1 font-semibold">Total acquisition <Money value={num(f.price) + num(f.buyerFees) + num(f.auctionFees) + num(f.taxes)} /></p></div></div><p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Submitting creates the inventory vehicle, purchase record, any payment and journal entries together. The store rejects duplicate VINs.</p></section>}
    </WorkflowPage>
  )

  return (
    <>
      <PageHeader
        title="Purchases"
        subtitle={`${state.purchases.length} acquisitions — each one creates the vehicle, payment and journal entries together.`}
        actions={
          <>
            <ExportButton filename="purchases.csv" rows={filtered.map((p) => {
              const v = vehicleById.get(p.vehicleId)
              return {
                Ref: p.ref, Date: p.purchaseDate, Stock: v?.stockNumber ?? '', Vehicle: v ? `${v.year} ${v.make} ${v.model}` : '',
                VIN: v?.vin ?? '', Seller: p.seller, Auction: p.auction,
                VehiclePrice: p.vehiclePrice, BuyerFees: p.buyerFees, AuctionFees: p.auctionFees,
                Taxes: p.taxes, Total: p.vehiclePrice + p.buyerFees + p.auctionFees + p.taxes,
                PaymentMethod: p.paymentMethod, PaymentStatus: p.paymentStatus,
              }
            })} />
            <JXButton variant="contained" size="sm" onClick={openPurchasePage}>
              <span className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />Record purchase</span>
            </JXButton>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Purchases" value={String(state.purchases.length)} sub={`${paidCount} paid in full`} />
        <KpiCard label="Vehicle prices" value={fmtMoney(totalVehicle)} tone="sky" />
        <KpiCard label="Fees + taxes" value={fmtMoney(totalFees)} sub="Buyer + auction fees + taxes" tone="amber" />
        <KpiCard label="Total acquisition cost" value={fmtMoney(totalAllIn)} tone="emerald" />
      </div>

      {success && <div className="mb-4"><Alert severity="success" title="Purchase recorded" description={success} /></div>}

      <div className="mb-4 flex flex-wrap gap-3">
        <JXTextField id="purchases-search" aria-label="Search purchases by ref, seller, auction, stock number, VIN, or make" className="jx-text-field max-w-sm" label="" placeholder="Search ref, seller, auction, stock no, VIN, make…" value={search} onChange={setSearch} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No purchases found" detail="Adjust the search, or record a purchase to add the first acquisition." action={<JXButton variant="contained" size="sm" lockWidth={false} onClick={openPurchasePage}>Record purchase</JXButton>} />
      ) : (
        <>
          <TableScrollHint />
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
            <ResponsiveTable><table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-4 py-3">Ref</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Seller / Auction</th><th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Fees + taxes</th><th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Payment</th><th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => {
                  const v = vehicleById.get(p.vehicleId)
                  const fees = p.buyerFees + p.auctionFees + p.taxes
                  return (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700">
                      <td className="px-4 py-3 font-mono font-semibold">{p.ref}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{p.purchaseDate}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {v ? `${v.year} ${v.make} ${v.model}` : 'Vehicle not found'}
                          {v && <span className="ml-2 font-mono text-xs font-normal text-slate-500 dark:text-slate-400">{v.stockNumber}</span>}
                        </p>
                        {v && <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{v.vin}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p>{p.seller}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{p.auction}</p>
                      </td>
                      <td className="px-4 py-3 text-right"><Money value={p.vehiclePrice} /></td>
                      <td className="px-4 py-3 text-right"><Money value={fees} /></td>
                      <td className="px-4 py-3 text-right font-semibold"><Money value={p.vehiclePrice + fees} /></td>
                      <td className="px-4 py-3">{p.paymentMethod}</td>
                      <td className="px-4 py-3"><StatusChip value={p.paymentStatus} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table></ResponsiveTable>
          </div>
        </>
      )}
      {controls}
            </>
            )
}
