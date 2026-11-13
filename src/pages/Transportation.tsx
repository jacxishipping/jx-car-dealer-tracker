// Transportation — transport orders, status advance, delivery documents.
// Delivering an order (store updateTransport) adds its price to the vehicle
// cost basis and sets an In-transit vehicle to Received.
import { useMemo, useState } from 'react'
import { JXButton, JXSelect } from '@jacxishippingorg/jx-ui-react'
import { ChevronDown, ChevronUp, Plus, Truck } from 'lucide-react'
import { useStore } from '../store/store'
import { fmtMoney, TRANSPORT_STATUSES, type TransportOrder, type TransportStatus } from '../store/types'
import {
  Alert, EmptyState, ExportButton, Field, inputCls, KpiCard, Modal,
  Money, PageHeader, selectCls, StatusChip, TableScrollHint, usePagination,
} from '../components/ui'

const today = () => new Date().toISOString().slice(0, 10)
const num = (v: string) => (v === '' ? 0 : Number(v))

export default function Transportation() {
  const { state, addTransport, updateTransport } = useStore()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('All')
  const [carrierFilter, setCarrierFilter] = useState('All')
  const [expanded, setExpanded] = useState<string | null>(null)

  const vehicleById = useMemo(() => new Map(state.vehicles.map((v) => [v.id, v])), [state.vehicles])

  const sorted = useMemo(
    () => [...state.transport].sort((a, b) => b.pickupDate.localeCompare(a.pickupDate)),
    [state.transport],
  )
  const filtered = sorted.filter((t) =>
    (statusFilter === 'All' || t.status === statusFilter) &&
    (carrierFilter === 'All' || t.carrier === carrierFilter))
  const { pageItems, controls } = usePagination(filtered, 10)

  const carriers = useMemo(() => [...new Set(state.transport.map((t) => t.carrier))], [state.transport])
  const totalPrice = state.transport.reduce((s, t) => s + t.price, 0)
  const unpaid = state.transport.filter((t) => t.paymentStatus !== 'Paid').reduce((s, t) => s + t.price, 0)
  const inTransit = state.transport.filter((t) => t.status === 'In transit' || t.status === 'Picked up').length
  const delivered = state.transport.filter((t) => t.status === 'Delivered').length

  const advance = (order: TransportOrder, next: TransportStatus) => {
    if (next === order.status) return
    const patch: Partial<TransportOrder> = { status: next }
    if (next === 'Delivered' && !order.actualDelivery) patch.actualDelivery = today()
    updateTransport(order.id, patch)
    if (next === 'Delivered') {
      const v = vehicleById.get(order.vehicleId)
      setSuccess(`Order for ${v?.stockNumber ?? order.vehicleId} delivered — ${fmtMoney(order.price)} added to the vehicle cost basis${v?.status === 'In transit' ? ' and the vehicle is now Received' : ''}.`)
    }
  }

  // ---- New transport order form ----
  const [f, setF] = useState({
    vehicleId: '', carrier: '', driver: '', pickupLocation: '', deliveryLocation: 'JX Auto Sales Lot A',
    pickupDate: today(), expectedDelivery: today(), price: '', status: 'Scheduled' as TransportStatus,
    gatePass: '', billOfLading: '', damageNotes: '', invoiceRef: '', paymentStatus: 'Unpaid',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }))

  const submit = () => {
    setError(null)
    if (!f.vehicleId) { setError('Choose a vehicle.'); return }
    if (!f.carrier.trim() || !f.pickupLocation.trim() || !f.deliveryLocation.trim() || !f.price) {
      setError('Carrier, pickup location, delivery location and price are required.')
      return
    }
    addTransport({
      vehicleId: f.vehicleId,
      carrier: f.carrier.trim(),
      driver: f.driver.trim() || '—',
      pickupLocation: f.pickupLocation.trim(),
      deliveryLocation: f.deliveryLocation.trim(),
      pickupDate: f.pickupDate || today(),
      expectedDelivery: f.expectedDelivery || today(),
      actualDelivery: null,
      price: num(f.price),
      status: f.status,
      gatePass: f.gatePass.trim(),
      billOfLading: f.billOfLading.trim(),
      damageNotes: f.damageNotes.trim(),
      invoiceRef: f.invoiceRef.trim(),
      paymentStatus: f.paymentStatus as TransportOrder['paymentStatus'],
      photos: [],
    })
    setSuccess(`Transport order created for ${vehicleById.get(f.vehicleId)?.stockNumber ?? ''} (${f.carrier.trim()}, ${fmtMoney(num(f.price))}).`)
    setOpen(false)
    setF({ ...f, vehicleId: '', carrier: '', driver: '', pickupLocation: '', price: '', gatePass: '', billOfLading: '', damageNotes: '', invoiceRef: '' })
  }

  return (
    <>
      <PageHeader
        title="Transportation"
        subtitle={`${state.transport.length} transport orders — delivering one adds its price to the vehicle cost basis.`}
        actions={
          <>
            <ExportButton filename="transport.csv" rows={filtered.map((t) => {
              const v = vehicleById.get(t.vehicleId)
              return {
                Stock: v?.stockNumber ?? '', Vehicle: v ? `${v.year} ${v.make} ${v.model}` : '', Carrier: t.carrier,
                Driver: t.driver, Pickup: t.pickupLocation, Delivery: t.deliveryLocation,
                PickupDate: t.pickupDate, ExpectedDelivery: t.expectedDelivery, ActualDelivery: t.actualDelivery ?? '',
                Price: t.price, Status: t.status, GatePass: t.gatePass, BillOfLading: t.billOfLading,
                InvoiceRef: t.invoiceRef, DamageNotes: t.damageNotes, PaymentStatus: t.paymentStatus,
              }
            })} />
            <JXButton variant="contained" size="sm" onClick={() => { setError(null); setOpen(true) }}>
              <span className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />New transport order</span>
            </JXButton>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Orders" value={String(state.transport.length)} sub={`${inTransit} on the road`} />
        <KpiCard label="Delivered" value={String(delivered)} tone="emerald" />
        <KpiCard label="Total transport cost" value={fmtMoney(totalPrice)} tone="sky" />
        <KpiCard label="Unpaid / partial" value={fmtMoney(unpaid)} sub="Orders not fully paid" tone="amber" />
      </div>

      {success && <div className="mb-4"><Alert severity="success" title="Transport updated" description={success} /></div>}

      <div className="mb-4 flex flex-wrap gap-3">
        <div>
          <label htmlFor="transport-status-filter" className="sr-only">Filter by status</label>
          <select id="transport-status-filter" className={`${selectCls} w-full sm:w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option>All</option>
            {TRANSPORT_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="transport-carrier-filter" className="sr-only">Filter by carrier</label>
          <select id="transport-carrier-filter" className={`${selectCls} w-full sm:w-auto`} value={carrierFilter} onChange={(e) => setCarrierFilter(e.target.value)} aria-label="Filter by carrier">
            <option>All</option>
            {carriers.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No transport orders found" detail="Adjust the filters, or create a new transport order." action={<JXButton variant="contained" size="sm" lockWidth={false} onClick={() => setOpen(true)}>New transport order</JXButton>} />
      ) : (
        <>
          <TableScrollHint />
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Carrier / Driver</th>
                  <th className="px-4 py-3">Pickup → Delivery</th><th className="px-4 py-3">Dates</th>
                  <th className="px-4 py-3 text-right">Price</th><th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Payment</th><th className="px-4 py-3">Docs</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((t) => {
                  const v = vehicleById.get(t.vehicleId)
                  const isOpen = expanded === t.id
                  return (
                    <tr key={t.id} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-700">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {v ? `${v.year} ${v.make} ${v.model}` : 'Vehicle not found'}
                        </p>
                        {v && <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{v.stockNumber} · {v.status}</p>}
                      </td>
                      <td className="px-4 py-3"><p>{t.carrier}</p><p className="text-xs text-slate-500 dark:text-slate-400">{t.driver}</p></td>
                      <td className="px-4 py-3">
                        <p>{t.pickupLocation}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">→ {t.deliveryLocation}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p>Pickup {t.pickupDate}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">ETA {t.expectedDelivery}</p>
                        {t.actualDelivery && <p className="text-xs text-emerald-700 dark:text-emerald-400">Delivered {t.actualDelivery}</p>}
                      </td>
                      <td className="px-4 py-3 text-right"><Money value={t.price} /></td>
                      <td className="px-4 py-3">
                        <JXSelect
                          label={`Order status for ${v?.stockNumber ?? t.id}`}
                          className="jx-select-field jx-sr-label"
                          options={TRANSPORT_STATUSES.map((s) => ({ id: s, label: s }))}
                          value={t.status}
                          onChange={(val) => advance(t, val as TransportStatus)}
                        />
                        <p className="mt-1 text-[11px] leading-tight text-slate-500 dark:text-slate-400">Changing to Delivered adds the price to cost basis.</p>
                      </td>
                      <td className="px-4 py-3"><StatusChip value={t.paymentStatus} /></td>
                      <td className="px-4 py-3">
                        <JXButton variant="outlined" size="sm" lockWidth={false} onClick={() => setExpanded(isOpen ? null : t.id)}>
                          <span className="inline-flex items-center gap-1">
                            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {isOpen ? 'Hide' : 'Details'}
                          </span>
                        </JXButton>
                        {isOpen && (
                          <div className="mt-2 w-64 rounded-[var(--radius-control)] bg-slate-50 p-3 text-xs dark:bg-slate-900">
                            <dl className="space-y-1">
                              <div className="flex justify-between gap-2"><dt className="text-slate-500 dark:text-slate-400">Gate pass</dt><dd className="font-mono">{t.gatePass || '—'}</dd></div>
                              <div className="flex justify-between gap-2"><dt className="text-slate-500 dark:text-slate-400">Bill of lading</dt><dd className="font-mono">{t.billOfLading || '—'}</dd></div>
                              <div className="flex justify-between gap-2"><dt className="text-slate-500 dark:text-slate-400">Invoice ref</dt><dd className="font-mono">{t.invoiceRef || '—'}</dd></div>
                              <div className="flex justify-between gap-2"><dt className="text-slate-500 dark:text-slate-400">Photos</dt><dd>{t.photos.length ? t.photos.join(', ') : '—'}</dd></div>
                            </dl>
                            <p className="mt-2 text-slate-500 dark:text-slate-400">Damage notes</p>
                            <p className="text-slate-700 dark:text-slate-200">{t.damageNotes || 'None noted.'}</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {controls}

      {open && (
        <Modal title="New transport order" onClose={() => setOpen(false)} wide>
          {error && <div className="mb-4"><Alert severity="error" title="Could not create order" description={error} /></div>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vehicle *">
              <select className={selectCls} value={f.vehicleId} onChange={set('vehicleId')}>
                <option value="">Select a vehicle…</option>
                {state.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.stockNumber} — {v.year} {v.make} {v.model} ({v.status})</option>
                ))}
              </select>
            </Field>
            <Field label="Carrier *"><input className={inputCls} value={f.carrier} onChange={set('carrier')} placeholder="e.g. SwiftHaul Logistics" /></Field>
            <Field label="Driver"><input className={inputCls} value={f.driver} onChange={set('driver')} placeholder="Driver name" /></Field>
            <Field label="Status">
              <select className={selectCls} value={f.status} onChange={(e) => setF((p) => ({ ...p, status: e.target.value as TransportStatus }))}>
                {TRANSPORT_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Pickup location *"><input className={inputCls} value={f.pickupLocation} onChange={set('pickupLocation')} placeholder="e.g. Metro Auction Yard, Dubai" /></Field>
            <Field label="Delivery location *"><input className={inputCls} value={f.deliveryLocation} onChange={set('deliveryLocation')} /></Field>
            <Field label="Pickup date"><input type="date" className={inputCls} value={f.pickupDate} onChange={set('pickupDate')} /></Field>
            <Field label="Expected delivery"><input type="date" className={inputCls} value={f.expectedDelivery} onChange={set('expectedDelivery')} /></Field>
            <Field label="Price (USD) *"><input type="number" min="0" step="0.01" className={inputCls} value={f.price} onChange={set('price')} placeholder="0.00" /></Field>
            <Field label="Payment status">
              <select className={selectCls} value={f.paymentStatus} onChange={set('paymentStatus')}>
                {['Paid', 'Partial', 'Unpaid'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Gate pass"><input className={inputCls} value={f.gatePass} onChange={set('gatePass')} placeholder="e.g. GP-4521" /></Field>
            <Field label="Bill of lading"><input className={inputCls} value={f.billOfLading} onChange={set('billOfLading')} placeholder="e.g. BOL-88310" /></Field>
            <Field label="Invoice ref"><input className={inputCls} value={f.invoiceRef} onChange={set('invoiceRef')} placeholder="e.g. INV-SH-2401" /></Field>
            <Field label="Damage notes"><input className={inputCls} value={f.damageNotes} onChange={set('damageNotes')} placeholder="None noted, or describe damage" /></Field>
          </div>
            <p className="mt-4 flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Truck className="mt-0.5 h-4 w-4 shrink-0" />
              Marking an order Delivered later adds its price to the vehicle&apos;s cost basis and sets an In-transit vehicle to Received.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <JXButton variant="outlined" size="sm" onClick={() => setOpen(false)}>Cancel</JXButton>
              <JXButton variant="contained" size="sm" onClick={submit}>Create order</JXButton>
            </div>
        </Modal>
      )}
    </>
  )
}
