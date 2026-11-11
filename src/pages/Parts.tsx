import { useMemo, useState } from 'react'
import { JXButton, JXCard, JXSelect, JXTextField } from '@jacxishippingorg/jx-ui-react'
import { useStore } from '../store/store'
import { partStock, partValue } from '../store/engine'
import { fmtMoney } from '../store/types'
import { Alert, EmptyState, ExportButton, Field, inputCls, KpiCard, Modal, Money, PageHeader, usePagination } from '../components/ui'

export default function Parts() {
  const { state, receivePartBatch, allocatePart } = useStore()
  const { parts, partBatches, partMovements, partAllocations, vehicles } = state
  const [search, setSearch] = useState('')
  const [selectedPartId, setSelectedPartId] = useState<string | null>(parts[0]?.id ?? null)
  const [movementFilter, setMovementFilter] = useState('All')
  const [showReceive, setShowReceive] = useState(false)

  // Receive batch form
  const [recvPartId, setRecvPartId] = useState(parts[0]?.id ?? '')
  const [recvQty, setRecvQty] = useState('')
  const [recvPrice, setRecvPrice] = useState('')
  const [recvInvoice, setRecvInvoice] = useState('')
  const [recvError, setRecvError] = useState('')
  const [recvDone, setRecvDone] = useState('')

  // Allocate form
  const [allocPartId, setAllocPartId] = useState(parts[0]?.id ?? '')
  const [allocVehicleId, setAllocVehicleId] = useState('')
  const [allocQty, setAllocQty] = useState('')
  const [allocResult, setAllocResult] = useState<{ ok: boolean; text: string } | null>(null)

  const filteredParts = parts.filter((p) => {
    const q = search.trim().toLowerCase()
    return !q || [p.name, p.sku, p.manufacturer, p.supplier].some((x) => x.toLowerCase().includes(q))
  })
  const totalValue = parts.reduce((s, p) => s + partValue(partBatches, p.id), 0)
  const reorderParts = parts.filter((p) => partStock(partBatches, p.id) <= p.minStock)
  const lowCount = reorderParts.length
  const selectedPart = parts.find((p) => p.id === selectedPartId) ?? null
  const selectedBatches = selectedPart ? partBatches.filter((b) => b.partId === selectedPart.id).sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate)) : []
  const selectedAllocations = selectedPart ? partAllocations.filter((a) => a.partId === selectedPart.id) : []

  const filteredMovements = useMemo(() => {
    const rows = [...partMovements].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    return movementFilter === 'All' ? rows : rows.filter((m) => m.type === movementFilter)
  }, [partMovements, movementFilter])
  const { pageItems: movementItems, controls: movementControls } = usePagination(filteredMovements, 10)
  const saleMovements = partMovements.filter((m) => m.type === 'sale')

  const submitReceive = () => {
    const qty = parseInt(recvQty, 10)
    const price = parseFloat(recvPrice)
    if (!recvPartId) { setRecvError('Select a part.'); return }
    if (!Number.isFinite(qty) || qty <= 0) { setRecvError('Quantity received must be a positive whole number.'); return }
    if (!Number.isFinite(price) || price < 0) { setRecvError('Unit price must be zero or more.'); return }
    if (!recvInvoice.trim()) { setRecvError('Invoice reference is required.'); return }
    receivePartBatch(recvPartId, qty, price, recvInvoice.trim())
    const part = parts.find((p) => p.id === recvPartId)
    setRecvDone(`${qty} × ${part?.name ?? recvPartId} received at ${fmtMoney(price)} each (invoice ${recvInvoice.trim()}). New batch added at FIFO cost ${fmtMoney(price)}.`)
    setRecvError(''); setRecvQty(''); setRecvPrice(''); setRecvInvoice('')
    setSelectedPartId(recvPartId)
  }

  const submitAllocate = () => {
    const qty = parseInt(allocQty, 10)
    if (!allocPartId) { setAllocResult({ ok: false, text: 'Select a part.' }); return }
    if (!allocVehicleId) { setAllocResult({ ok: false, text: 'Select a vehicle.' }); return }
    if (!Number.isFinite(qty) || qty <= 0) { setAllocResult({ ok: false, text: 'Quantity must be a positive whole number.' }); return }
    const res = allocatePart(allocPartId, allocVehicleId, qty)
    const part = parts.find((p) => p.id === allocPartId)
    const veh = vehicles.find((v) => v.id === allocVehicleId)
    setAllocResult(res.ok
      ? { ok: true, text: `${qty} × ${part?.name ?? ''} allocated to ${veh?.stockNumber ?? allocVehicleId} — FIFO cost ${fmtMoney(res.cost ?? 0)}. Oldest batches were consumed first.` }
      : { ok: false, text: res.error ?? 'Allocation failed.' })
    if (res.ok) { setAllocQty(''); setSelectedPartId(allocPartId) }
  }

  const allocPart = parts.find((p) => p.id === allocPartId)
  const allocStock = allocPart ? partStock(partBatches, allocPart.id) : 0

  return (
    <>
      <PageHeader
        title="Parts &amp; Inventory"
        subtitle="FIFO stock: oldest batches are consumed first, so the cost of every allocation is the real batch cost."
        actions={[
          <JXButton key="recv" variant="contained" size="sm" onClick={() => { setRecvError(''); setRecvDone(''); setShowReceive(true) }}>+ Receive batch</JXButton>,
          <ExportButton key="exp" filename="parts.csv" rows={parts.map((p) => ({ sku: p.sku, name: p.name, manufacturer: p.manufacturer, supplier: p.supplier, stock: partStock(partBatches, p.id), minStock: p.minStock, fifoValue: partValue(partBatches, p.id) }))} />,
        ]}
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Parts in catalog" value={String(parts.length)} sub={`${partBatches.length} batches on hand`} />
        <KpiCard label="Total stock value (FIFO)" value={fmtMoney(totalValue)} sub="Remaining batches at batch cost" tone="emerald" />
        <KpiCard label="Reorder alerts" value={String(lowCount)} sub={lowCount > 0 ? 'At or below minimum stock' : 'All parts above minimum'} tone={lowCount > 0 ? 'rose' : 'emerald'} />
        <KpiCard label="Counter sales recorded" value={String(saleMovements.length)} sub="Movements of type 'sale'" tone="sky" />
      </div>

      {lowCount > 0 && (
        <div className="mb-4">
          <Alert severity="warning" title={`${lowCount} part${lowCount === 1 ? '' : 's'} at or below minimum stock`} description={reorderParts.map((p) => `${p.name} (${partStock(partBatches, p.id)} on hand, min ${p.minStock})`).join(' · ') + ' — receive a new batch to reorder.'} />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-5">
        {/* Catalog */}
        <div className="xl:col-span-3">
          <JXCard title="Parts catalog" description={`${filteredParts.length} part${filteredParts.length === 1 ? '' : 's'} · stock and value are FIFO figures from live batches`}>
            <div className="mb-3"><JXTextField value={search} onChange={setSearch} placeholder="Search part, SKU, manufacturer, supplier…" /></div>
            {filteredParts.length === 0 ? (
              <EmptyState title="No parts match" detail="Adjust the search." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                    <th className="py-2 pr-2">Part</th><th className="py-2 pr-2">Supplier</th><th className="py-2 pr-2 text-right">Stock</th><th className="py-2 pr-2 text-right">Min</th><th className="py-2 pr-2 text-right">FIFO value</th><th className="py-2" />
                  </tr></thead>
                  <tbody>
                    {filteredParts.map((p) => {
                      const stock = partStock(partBatches, p.id)
                      const low = stock <= p.minStock
                      return (
                        <tr key={p.id} className={`border-b border-slate-100 dark:border-slate-800 ${selectedPartId === p.id ? 'bg-indigo-50 dark:bg-indigo-950/40' : ''}`}>
                          <td className="py-2 pr-2"><span className="font-semibold text-slate-900 dark:text-white">{p.name}</span><span className="block font-mono text-xs text-slate-500">{p.sku} · {p.manufacturer}</span></td>
                          <td className="py-2 pr-2">{p.supplier}</td>
                          <td className={`py-2 pr-2 text-right font-semibold ${low ? 'text-rose-600' : ''}`}>{stock}{low && <span className="block text-xs font-normal">REORDER</span>}</td>
                          <td className="py-2 pr-2 text-right">{p.minStock}</td>
                          <td className="py-2 pr-2 text-right"><Money value={partValue(partBatches, p.id)} /></td>
                          <td className="py-2 text-right"><JXButton variant="text" size="sm" onClick={() => setSelectedPartId(p.id)}>Batches</JXButton></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </JXCard>

          {/* Movements */}
          <div className="mt-5">
            <JXCard title="Movements history" description="Purchases in, FIFO consumption out, returns and adjustments — and counter sales (type 'sale').">
              <div className="mb-3 flex flex-wrap gap-2">
                {['All', 'purchase', 'consume', 'sale', 'return', 'adjust'].map((t) => (
                  <JXButton key={t} variant={movementFilter === t ? 'contained' : 'outlined'} size="sm" onClick={() => setMovementFilter(t)}>{t === 'All' ? 'All' : t}</JXButton>
                ))}
              </div>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Counter-sale note: parts sold over the counter are recorded as movements of type &lsquo;sale&rsquo; and shown here — there is no separate counter-sale action in the store.
                Seed FIFO example: 12 brake pads to CDT-103 cost $620 (10 @ $50 from batch b-001 + 2 @ $60 from batch b-002).
              </p>
              {movementItems.length === 0 ? (
                <EmptyState title="No movements of this type" detail="Change the movement filter." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                      <th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Part</th><th className="py-2 pr-2">Type</th><th className="py-2 pr-2 text-right">Qty</th><th className="py-2 pr-2 text-right">Unit cost</th><th className="py-2 pr-2 text-right">Total</th><th className="py-2 pr-2">Vehicle / note</th>
                    </tr></thead>
                    <tbody>
                      {movementItems.map((m) => {
                        const p = parts.find((x) => x.id === m.partId)
                        const v = m.vehicleId ? vehicles.find((x) => x.id === m.vehicleId) : undefined
                        return (
                          <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800">
                            <td className="py-2 pr-2">{m.date}</td>
                            <td className="py-2 pr-2">{p ? `${p.name} (${p.sku})` : m.partId}</td>
                            <td className="py-2 pr-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.type === 'purchase' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200' : m.type === 'sale' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'}`}>{m.type}</span></td>
                            <td className={`py-2 pr-2 text-right font-semibold ${m.qty < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                            <td className="py-2 pr-2 text-right"><Money value={m.unitCost} /></td>
                            <td className="py-2 pr-2 text-right"><Money value={m.totalCost} /></td>
                            <td className="py-2 pr-2 text-xs text-slate-500">{v ? v.stockNumber : ''}{v && m.note ? ' · ' : ''}{m.note}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {movementControls}
            </JXCard>
          </div>
        </div>

        {/* Part detail + allocate */}
        <div className="xl:col-span-2 space-y-5">
          {!selectedPart ? (
            <EmptyState title="No part selected" detail="Select a part from the catalog to see its batches." />
          ) : (
            <JXCard
              title={`${selectedPart.name} (${selectedPart.sku})`}
              kicker={partStock(partBatches, selectedPart.id) <= selectedPart.minStock ? 'Reorder — at or below minimum stock' : 'In stock'}
              description={`${selectedPart.manufacturer} · supplied by ${selectedPart.supplier} · min stock ${selectedPart.minStock} · on hand ${partStock(partBatches, selectedPart.id)} · FIFO value ${fmtMoney(partValue(partBatches, selectedPart.id))}`}
            >
              <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Batches (oldest first — FIFO order)</h3>
              {selectedBatches.length === 0 ? <p className="mb-3 text-sm text-slate-500">No batches on record.</p> : (
                <div className="mb-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                      <th className="py-2 pr-2">Batch</th><th className="py-2 pr-2">Invoice</th><th className="py-2 pr-2">Date</th><th className="py-2 pr-2 text-right">Remaining</th><th className="py-2 text-right">Unit price</th>
                    </tr></thead>
                    <tbody>
                      {selectedBatches.map((b) => (
                        <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-2 pr-2 font-mono">{b.id}</td>
                          <td className="py-2 pr-2 font-mono">{b.invoice}</td>
                          <td className="py-2 pr-2">{b.purchaseDate}</td>
                          <td className="py-2 pr-2 text-right">{b.qtyRemaining} / {b.qtyReceived}</td>
                          <td className="py-2 text-right"><Money value={b.unitPrice} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Allocations to vehicles</h3>
              {selectedAllocations.length === 0 ? <p className="text-sm text-slate-500">No allocations yet.</p> : (
                <ul className="space-y-2 text-sm">
                  {selectedAllocations.map((a) => {
                    const v = vehicles.find((x) => x.id === a.vehicleId)
                    return (
                      <li key={a.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        {a.qty} × to {v ? `${v.stockNumber} (${v.year} ${v.make} ${v.model})` : a.vehicleId} on {a.date} — FIFO cost <Money value={a.fifoCost} />
                        <span className="block text-xs text-slate-500">{a.batches.map((s) => `${s.qty} @ ${fmtMoney(s.unitPrice)} (${s.batchId})`).join(' + ')}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </JXCard>
          )}

          <JXCard title="Allocate to vehicle" description="Consumes the oldest batches first (FIFO). The returned FIFO cost is shown below — and the store's insufficient-stock error if there is not enough stock.">
            {allocResult && <div className="mb-3"><Alert severity={allocResult.ok ? 'success' : 'error'} title={allocResult.ok ? 'Allocated' : 'Cannot allocate'} description={allocResult.text} /></div>}
            <div className="space-y-3">
              <Field label="Part">
                <JXSelect searchable placeholder="Select a part" value={allocPartId} onChange={(v) => { setAllocPartId(v); setAllocResult(null) }}
                  options={parts.map((p) => ({ id: p.id, label: `${p.name} (${p.sku}) · ${partStock(partBatches, p.id)} in stock` }))} />
              </Field>
              <Field label="Vehicle">
                <JXSelect searchable placeholder="Select a vehicle" value={allocVehicleId} onChange={setAllocVehicleId}
                  options={vehicles.map((v) => ({ id: v.id, label: `${v.stockNumber} — ${v.year} ${v.make} ${v.model} · ${v.status}` }))} />
              </Field>
              <Field label="Quantity" hint={allocPart ? `${allocStock} available` : undefined}>
                <input className={inputCls} type="number" min="1" step="1" value={allocQty} onChange={(e) => setAllocQty(e.target.value)} placeholder="e.g. 12" />
              </Field>
              <JXButton variant="contained" onClick={submitAllocate}>Allocate (FIFO)</JXButton>
              <p className="text-xs text-slate-500">Example from the seed data: allocating 12 brake pads to CDT-103 cost $620 — 10 @ $50 + 2 @ $60.</p>
            </div>
          </JXCard>
        </div>
      </div>

      {showReceive && (
        <Modal title="Receive batch" onClose={() => setShowReceive(false)}>
          {recvError && <div className="mb-3"><Alert severity="error" title="Check the form" description={recvError} /></div>}
          {recvDone && <div className="mb-3"><Alert severity="success" title="Batch received" description={recvDone} /></div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Part">
                <JXSelect searchable placeholder="Select a part" value={recvPartId} onChange={setRecvPartId}
                  options={parts.map((p) => ({ id: p.id, label: `${p.name} (${p.sku})` }))} />
              </Field>
            </div>
            <Field label="Quantity received *"><input className={inputCls} type="number" min="1" step="1" value={recvQty} onChange={(e) => setRecvQty(e.target.value)} placeholder="e.g. 10" /></Field>
            <Field label="Unit price *"><input className={inputCls} type="number" min="0" step="0.01" value={recvPrice} onChange={(e) => setRecvPrice(e.target.value)} placeholder="e.g. 60.00" /></Field>
            <div className="sm:col-span-2"><Field label="Invoice reference *"><JXTextField value={recvInvoice} onChange={setRecvInvoice} placeholder="e.g. INV-PW-141" /></Field></div>
          </div>
          <p className="mt-3 text-xs text-slate-500">The new batch is dated today and becomes the newest FIFO batch — older batches are still consumed first.</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <JXButton variant="outlined" onClick={() => setShowReceive(false)}>Close</JXButton>
            <JXButton variant="contained" onClick={submitReceive}>Receive batch</JXButton>
          </div>
        </Modal>
      )}
    </>
  )
}
