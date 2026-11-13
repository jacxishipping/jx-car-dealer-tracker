import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { JXCard, JXSelect } from '@jacxishippingorg/jx-ui-react'
import { useStore } from '../store/store'
import { VEHICLE_STATUSES, fmtMoney } from '../store/types'
import type { VehicleStatus } from '../store/types'
import { daysInStock, vehicleAllInCost, vehicleDirectExpenses, vehiclePartsCost } from '../store/engine'
import { EmptyState, Money, PageHeader, StatusChip } from '../components/ui'

function Section({ title, kicker, children }: { title: string; kicker?: string; children: React.ReactNode }) {
  return (
      <JXCard title={title} kicker={kicker} className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
        {children}
      </JXCard>
      )
}

      function Row({label, children}: {label: string; children: React.ReactNode }) {
  return (
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-700">
          <span className="text-slate-500 dark:text-slate-400">{label}</span>
          <span className="text-right font-medium text-slate-900 dark:text-white">{children}</span>
        </div>
        )
}

        function ListEmpty({text}: {text: string }) {
  return <p className="py-2 text-sm text-slate-500 dark:text-slate-400">{text}</p>
}

        export default function VehicleDetail() {
  const {id} = useParams<{ id: string }>()
        const {state, updateVehicleStatus} = useStore()
        const navigate = useNavigate()
  const vehicle = state.vehicles.find((v) => v.id === id)

        if (!vehicle) {
    return (
        <>
          <PageHeader title="Vehicle not found" subtitle="This vehicle does not exist in the tracker." />
          <EmptyState
            title="No vehicle with this ID"
            detail="It may have been removed, or the link is wrong. Go back to the inventory list to pick a vehicle."
            action={<Link to="/inventory" className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"><ArrowLeft className="h-4 w-4" />Back to inventory</Link>}
          />
        </>
        )
  }

  const purchase = state.purchases.find((p) => p.vehicleId === vehicle.id)
  const transports = state.transport.filter((t) => t.vehicleId === vehicle.id)
  const reconJobs = state.reconJobs.filter((r) => r.vehicleId === vehicle.id)
  const allocations = state.partAllocations.filter((a) => a.vehicleId === vehicle.id)
  const expenses = state.expenses.filter((e) => e.vehicleId === vehicle.id)
  const docs = state.documents.filter((d) => d.entityType === 'Vehicle' && d.entityId === vehicle.id)
  const offers = state.offers.filter((o) => o.vehicleId === vehicle.id)
  const deals = state.deals.filter((d) => d.vehicleId === vehicle.id)
  const sales = state.sales.filter((s) => s.vehicleId === vehicle.id)
  const auditEvents = state.audit.filter((a) => a.entityId === vehicle.id)
  const customerName = (cid: string) => state.customers.find((c) => c.id === cid)?.name ?? cid
  const partName = (pid: string) => state.parts.find((p) => p.id === pid)?.name ?? pid

        const directExpenses = vehicleDirectExpenses(state.expenses, vehicle.id)
        const partsCost = vehiclePartsCost(state.partAllocations, vehicle.id)
        const overhead = state.settings.overheadPerVehicle
        const allIn = vehicleAllInCost(vehicle, state.expenses, state.partAllocations, overhead)
        const projectedProfit = vehicle.askingPrice - allIn
        const projectedMinProfit = vehicle.minPrice - allIn

        return (
    <>
          <PageHeader
            title={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            subtitle={`${vehicle.stockNumber} · VIN ${vehicle.vin} · ${daysInStock(vehicle)} days in stock`}
            actions={
                <button type="button" onClick={() => navigate('/inventory')} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-control)] border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                  <ArrowLeft className="h-4 w-4" />Back to inventory
                </button>
        }
      />

                <div className="mb-5 flex flex-wrap items-center gap-3">
                  <StatusChip value={vehicle.status} />
                  <div className="w-full sm:w-56">
                    <JXSelect
                      label="Change status"
                      className="jx-select-field jx-field-select"
                      options={VEHICLE_STATUSES.map((s) => ({ id: s, label: s }))}
                      value={vehicle.status}
                      onChange={(val) => updateVehicleStatus(vehicle.id, val as VehicleStatus)}
                    />
                  </div>
                  {vehicle.notes && <p className="text-sm text-slate-500 dark:text-slate-400">{vehicle.notes}</p>}
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <Section title="Overview" kicker={vehicle.stockNumber}>
                    <Row label="Stock number">{vehicle.stockNumber}</Row>
                    <Row label="VIN">{vehicle.vin}</Row>
                    <Row label="Year / Make / Model">{vehicle.year} {vehicle.make} {vehicle.model}</Row>
                    <Row label="Trim">{vehicle.trim || '—'}</Row>
                    <Row label="Condition">{vehicle.condition}</Row>
                    <Row label="Title status">{vehicle.titleStatus}</Row>
                    <Row label="Purchase date">{vehicle.purchaseDate}</Row>
                    <Row label="Purchase source">{vehicle.purchaseSource}</Row>
                    <Row label="Photos">{vehicle.photos.length > 0 ? vehicle.photos.join(', ') : 'None'}</Row>
                  </Section>

                  <Section title="Specifications" kicker="Specs">
                    <Row label="Exterior color">{vehicle.extColor || '—'}</Row>
                    <Row label="Interior color">{vehicle.intColor || '—'}</Row>
                    <Row label="Mileage">{vehicle.mileage.toLocaleString('en-US')} miles</Row>
                    <Row label="Transmission">{vehicle.transmission || '—'}</Row>
                    <Row label="Engine">{vehicle.engine || '—'}</Row>
                    <Row label="Fuel">{vehicle.fuel || '—'}</Row>
                    <Row label="Drivetrain">{vehicle.drivetrain || '—'}</Row>
                    <Row label="Body type">{vehicle.bodyType || '—'}</Row>
                  </Section>

                  <Section title="Acquisition" kicker={purchase ? purchase.ref : 'No purchase record'}>
                    {purchase ? (
                      <>
                        <Row label="Seller">{purchase.seller}</Row>
                        <Row label="Auction">{purchase.auction || '—'}</Row>
                        <Row label="Purchase date">{purchase.purchaseDate}</Row>
                        <Row label="Vehicle price"><Money value={purchase.vehiclePrice} /></Row>
                        <Row label="Buyer fees"><Money value={purchase.buyerFees} /></Row>
                        <Row label="Auction fees"><Money value={purchase.auctionFees} /></Row>
                        <Row label="Taxes"><Money value={purchase.taxes} /></Row>
                        <Row label="Transport estimate"><Money value={purchase.transportEstimate} /></Row>
                        <Row label="Payment method">{purchase.paymentMethod}</Row>
                        <Row label="Payment status"><StatusChip value={purchase.paymentStatus} /></Row>
                        <Row label="Documents">{purchase.documents || '—'}</Row>
                      </>
                    ) : (
                      <ListEmpty text={`No purchase record linked to this vehicle. Vehicle purchase price ${fmtMoney(vehicle.purchasePrice)} and auction fees ${fmtMoney(vehicle.auctionFees)} are recorded on the vehicle itself.`} />
                    )}
                  </Section>

                  <Section title="Transport history" kicker={`${transports.length} order${transports.length === 1 ? '' : 's'}`}>
                    {transports.length === 0 ? <ListEmpty text="No transport orders for this vehicle." /> : (
                      <ul className="space-y-3">
                        {transports.map((t) => (
                          <li key={t.id} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-slate-900 dark:text-white">{t.carrier} — {t.driver || 'no driver listed'}</span>
                              <StatusChip value={t.status} />
                            </div>
                            <p className="mt-1 text-slate-500 dark:text-slate-400">{t.pickupLocation} → {t.deliveryLocation}</p>
                            <p className="text-slate-500 dark:text-slate-400">Pickup {t.pickupDate} · expected {t.expectedDelivery}{t.actualDelivery ? ` · delivered ${t.actualDelivery}` : ''}</p>
                            <p className="mt-1">Price <Money value={t.price} /> · payment <StatusChip value={t.paymentStatus} />{t.invoiceRef ? ` · ${t.invoiceRef}` : ''}</p>
                            {t.gatePass && <p className="text-slate-500">Gate pass: {t.gatePass}</p>}
                            {t.billOfLading && <p className="text-slate-500">Bill of lading: {t.billOfLading}</p>}
                            {t.damageNotes && <p className="text-rose-600">Damage: {t.damageNotes}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>

                  <Section title="Reconditioning jobs" kicker={`${reconJobs.length} job${reconJobs.length === 1 ? '' : 's'}`}>
                    {reconJobs.length === 0 ? <ListEmpty text="No recon jobs for this vehicle." /> : (
                      <ul className="space-y-2 text-sm">
                        {reconJobs.map((j) => (
                          <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
                            <span><span className="font-medium text-slate-900 dark:text-white">{j.title}</span> <span className="text-slate-500">· {j.category} · {j.technician}</span></span>
                            <span className="flex items-center gap-2"><StatusChip value={j.status} /><Money value={j.actualCost || j.estimatedCost} /></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>

                  <Section title="Parts allocations (FIFO)" kicker={`${allocations.length} allocation${allocations.length === 1 ? '' : 's'}`}>
                    {allocations.length === 0 ? <ListEmpty text="No parts allocated to this vehicle." /> : (
                      <ul className="space-y-2 text-sm">
                        {allocations.map((a) => (
                          <li key={a.id} className="border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-slate-900 dark:text-white">{partName(a.partId)} — {a.qty} units</span>
                              <Money value={a.fifoCost} />
                            </div>
                            <p className="text-xs text-slate-500">{a.date} · FIFO batches: {a.batches.map((b) => `${b.qty} @ ${fmtMoney(b.unitPrice)}`).join(', ')}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-sm text-slate-500">Total FIFO parts cost: <Money value={partsCost} className="font-semibold text-slate-900 dark:text-white" /></p>
                  </Section>

                  <Section title="Expenses" kicker={`${expenses.length} record${expenses.length === 1 ? '' : 's'}`}>
                    {expenses.length === 0 ? <ListEmpty text="No expenses linked to this vehicle." /> : (
            <ul className="space-y-2 text-sm">
              {expenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-700">
                  <span><span className="font-medium text-slate-900 dark:text-white">{e.description}</span> <span className="text-slate-500 dark:text-slate-400">· {e.category} · {e.date} · {e.vendor}</span></span>
                  <span className="flex items-center gap-2"><StatusChip value={e.status} /><Money value={e.amount} /></span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Direct expenses total: <Money value={directExpenses} className="font-semibold text-slate-900 dark:text-white" /></p>
        </Section>

        <Section title="Documents" kicker={`${docs.length} file${docs.length === 1 ? '' : 's'}`}>
          {docs.length === 0 ? <ListEmpty text="No documents attached to this vehicle." /> : (
            <ul className="space-y-2 text-sm">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-700">
                  <span><span className="font-medium text-slate-900 dark:text-white">{d.title}</span> <span className="text-slate-500 dark:text-slate-400">· {d.type} · {d.fileName} ({(d.fileSize / 1024).toFixed(0)} KB)</span></span>
                  <span className="text-slate-500 dark:text-slate-400">{d.uploadedAt}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Inquiries & offers" kicker={`${offers.length} offer${offers.length === 1 ? '' : 's'}`}>
          {offers.length === 0 ? <ListEmpty text="No offers on this vehicle." /> : (
            <ul className="space-y-2 text-sm">
              {offers.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-700">
                  <span><span className="font-medium text-slate-900 dark:text-white">{customerName(o.customerId)}</span> <span className="text-slate-500 dark:text-slate-400">· {o.date}</span></span>
                  <span className="flex items-center gap-2"><StatusChip value={o.status} /><Money value={o.amount} /></span>
                </li>
              ))}
            </ul>
          )}
          {deals.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Deals</p>
              <ul className="mt-1 space-y-1 text-sm">
                {deals.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <span>{d.ref} — {customerName(d.customerId)} · {d.salesperson}</span>
                    <span className="flex items-center gap-2"><StatusChip value={d.status} /><Money value={d.sellingPrice} /></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="Sales history" kicker={`${sales.length} sale${sales.length === 1 ? '' : 's'}`}>
          {sales.length === 0 ? <ListEmpty text={vehicle.status === 'Sold' ? 'Vehicle is marked Sold but no sale record exists yet.' : 'Not sold yet.'} /> : (
            <ul className="space-y-2 text-sm">
              {sales.map((s) => (
                <li key={s.id} className="border-b border-slate-100 pb-2 last:border-0 dark:border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900 dark:text-white">{s.ref} — {customerName(s.customerId)} · {s.date}</span>
                    <Money value={s.sellingPrice} />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Net profit <Money value={s.netProfit} /> · margin {s.marginPct.toFixed(1)}%</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Financial breakdown" kicker="All-in cost">
          <Row label="Purchase price"><Money value={vehicle.purchasePrice} /></Row>
          <Row label="Auction fees"><Money value={vehicle.auctionFees} /></Row>
          <Row label="Transport cost"><Money value={vehicle.transportCost} /></Row>
          <Row label="Direct expenses"><Money value={directExpenses} /></Row>
          <Row label="FIFO parts cost"><Money value={partsCost} /></Row>
          <Row label={`Allocated overhead (${fmtMoney(overhead)} / vehicle)`}><Money value={overhead} /></Row>
          <Row label="All-in cost"><Money value={allIn} className="font-bold text-slate-900 dark:text-white" /></Row>
          <Row label="Asking price"><Money value={vehicle.askingPrice} /></Row>
          <Row label="Minimum price"><Money value={vehicle.minPrice} /></Row>
          <Row label="Projected profit at asking"><Money value={projectedProfit} className={projectedProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} /></Row>
          <Row label="Projected profit at minimum"><Money value={projectedMinProfit} className={projectedMinProfit >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} /></Row>
        </Section>

        <Section title="Timeline" kicker={`${auditEvents.length} event${auditEvents.length === 1 ? '' : 's'}`}>
          {auditEvents.length === 0 ? <ListEmpty text="No audit events recorded for this vehicle." /> : (
            <ol className="space-y-3 text-sm">
              {auditEvents.map((a) => (
                <li key={a.id} className="border-l-2 border-indigo-200 pl-3 dark:border-indigo-800">
                  <p className="font-medium text-slate-900 dark:text-white">{a.summary}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{a.action} · {a.actor} · {new Date(a.at).toLocaleString('en-US')}</p>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </>
  )
}
