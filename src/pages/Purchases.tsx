// Purchases — acquisition list + "Record purchase" (recordPurchase atomically
// creates vehicle + purchase + payment/journal + inventory entry).
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { JXButton } from '@jacxishippingorg/jx-ui-react'
import { AppTextField as JXTextField } from "../components/AppTextField"
import { Plus } from 'lucide-react'
import { useStore } from '../store/store'
import { fmtMoney, type Purchase } from '../store/types'
import {
  Alert, EmptyState, ExportButton, Field, inputCls, KpiCard, Modal,
  Money, PageHeader, selectCls, StatusChip, TableScrollHint, usePagination,
} from '../components/ui'

const today = () => new Date().toISOString().slice(0, 10)
const num = (v: string) => (v === '' ? 0 : Number(v))

export default function Purchases() {
  const { state, recordPurchase } = useStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const modalOpen = open || searchParams.get('new') === '1'
  const closeModal = () => {
    setOpen(false)
    if (searchParams.get('new')) setSearchParams({}, { replace: true })
  }
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
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
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }))

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
    setSuccess(`Purchase recorded — vehicle ${nextStock} (${year} ${vehicle.make} ${vehicle.model}) created and added to inventory.`)
    closeModal()
    setF({ ...f, seller: '', auction: '', vin: '', make: '', model: '', trim: '', mileage: '', price: '', buyerFees: '', auctionFees: '', taxes: '', transportEstimate: '', askingPrice: '', minPrice: '' })
  }

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
            <JXButton variant="contained" size="sm" onClick={() => { setError(null); setOpen(true) }}>
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
        <EmptyState title="No purchases found" detail="Adjust the search, or record a purchase to add the first acquisition." action={<JXButton variant="contained" size="sm" lockWidth={false} onClick={() => setOpen(true)}>Record purchase</JXButton>} />
      ) : (
        <>
          <TableScrollHint />
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
            <table className="w-full min-w-[900px] text-left text-sm">
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
            </table>
          </div>
        </>
      )}
      {controls}

      {modalOpen && (
        <Modal title={`Record purchase — new stock ${nextStock}`} onClose={closeModal} wide>
          {error && <div className="mb-4"><Alert severity="error" title="Could not record purchase" description={error} /></div>}
          <div className="space-y-5">
            <div>
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Seller &amp; Acquisition</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Seller *"><input className={inputCls} value={f.seller} onChange={set('seller')} placeholder="e.g. Metro Auto Auction" /></Field>
                <Field label="Auction"><input className={inputCls} value={f.auction} onChange={set('auction')} placeholder="e.g. Metro Lane 4" /></Field>
                <Field label="Source">
                  <select className={selectCls} value={f.source} onChange={set('source')}>
                    {['Auction', 'Wholesale', 'Private seller', 'Trade-in', 'Other dealer'].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Purchase date"><input type="date" className={inputCls} value={f.purchaseDate} onChange={set('purchaseDate')} /></Field>
              </div>
            </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Vehicle Identity</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="VIN *" hint={`${f.vin.trim().length}/17 characters`}><input className={inputCls} value={f.vin} onChange={set('vin')} placeholder="17-character VIN" maxLength={17} /></Field>
                  <Field label="Year"><input type="number" className={inputCls} value={f.year} onChange={set('year')} /></Field>
                  <Field label="Make *"><input className={inputCls} value={f.make} onChange={set('make')} placeholder="e.g. Honda" /></Field>
                  <Field label="Model *"><input className={inputCls} value={f.model} onChange={set('model')} placeholder="e.g. Accord" /></Field>
                  <Field label="Trim"><input className={inputCls} value={f.trim} onChange={set('trim')} placeholder="e.g. Sport" /></Field>
                  <Field label="Mileage"><input type="number" min="0" className={inputCls} value={f.mileage} onChange={set('mileage')} placeholder="0" /></Field>
                </div>
              </div>

                <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                  <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Pricing, Fees &amp; Payment</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Vehicle price (USD) *"><input type="number" min="0" step="0.01" className={inputCls} value={f.price} onChange={set('price')} placeholder="0.00" /></Field>
                    <Field label="Buyer fees (USD)"><input type="number" min="0" step="0.01" className={inputCls} value={f.buyerFees} onChange={set('buyerFees')} placeholder="0.00" /></Field>
                    <Field label="Auction fees (USD)"><input type="number" min="0" step="0.01" className={inputCls} value={f.auctionFees} onChange={set('auctionFees')} placeholder="0.00" /></Field>
                    <Field label="Taxes (USD)"><input type="number" min="0" step="0.01" className={inputCls} value={f.taxes} onChange={set('taxes')} placeholder="0.00" /></Field>
                    <Field label="Transport estimate (USD)"><input type="number" min="0" step="0.01" className={inputCls} value={f.transportEstimate} onChange={set('transportEstimate')} placeholder="0.00" /></Field>
                    <Field label="Asking price (USD) — defaults to price × 1.25"><input type="number" min="0" step="0.01" className={inputCls} value={f.askingPrice} onChange={set('askingPrice')} placeholder="Auto" /></Field>
                    <Field label="Minimum price (USD) — defaults to price × 1.15"><input type="number" min="0" step="0.01" className={inputCls} value={f.minPrice} onChange={set('minPrice')} placeholder="Auto" /></Field>
                    <Field label="Payment method">
                      <select className={selectCls} value={f.paymentMethod} onChange={set('paymentMethod')}>
                        {['Bank transfer', 'Cash', 'Card', 'Floorplan', 'Finance'].map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </Field>
                    <Field label="Payment status">
                      <select className={selectCls} value={f.paymentStatus} onChange={set('paymentStatus')}>
                        {['Paid', 'Partial', 'Unpaid'].map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </Field>
                  </div>
                </div>
              </div>
                <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                  Total acquisition cost: {fmtMoney(num(f.price) + num(f.buyerFees) + num(f.auctionFees) + num(f.taxes))}.
                  Recording creates the vehicle ({nextStock}), the purchase, the payment and the journal entry in one step.
                  A VIN that already exists is rejected by the store.
                </p>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <JXButton variant="outlined" size="sm" onClick={closeModal}>Cancel</JXButton>
                  <JXButton variant="contained" size="sm" onClick={submit}>Record purchase</JXButton>
                </div>
              </Modal>
      )}
            </>
            )
}
