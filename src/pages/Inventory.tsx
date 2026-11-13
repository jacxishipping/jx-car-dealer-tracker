import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { JXButton, JXButtonGroup, JXSelect } from '@jacxishippingorg/jx-ui-react'
import { AppTextField as JXTextField } from "../components/AppTextField"
import { useStore } from '../store/store'
import type { Vehicle, VehicleStatus } from '../store/types'
import { VEHICLE_STATUSES } from '../store/types'
import { daysInStock } from '../store/engine'
import { Alert, EmptyState, ExportButton, Field, Modal, Money, PageHeader, StatusChip, TableScrollHint, inputCls, usePagination } from '../components/ui'

type SortKey = 'price' | 'date' | 'mileage'

const emptyForm = {
  stockNumber: '', vin: '', year: String(new Date().getFullYear()), make: '', model: '', trim: '',
  extColor: '', intColor: '', mileage: '0', transmission: 'Automatic', engine: '', fuel: 'Petrol',
  drivetrain: 'FWD', bodyType: 'Sedan', condition: 'Good' as Vehicle['condition'],
  titleStatus: 'Clean' as Vehicle['titleStatus'], status: 'Purchased' as VehicleStatus,
  purchaseDate: new Date().toISOString().slice(0, 10), purchaseSource: 'Auction' as Vehicle['purchaseSource'],
  purchasePrice: '0', auctionFees: '0', transportCost: '0', askingPrice: '0', minPrice: '0',
  photos: '', notes: '',
}

export default function Inventory() {
  const { state, addVehicle } = useStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('All')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = state.vehicles.filter((v) => {
      const matchesQuery = !q || [v.vin, v.stockNumber, v.make, v.model].some((f) => f.toLowerCase().includes(q))
      const matchesStatus = statusFilter === 'All' || v.status === statusFilter
      return matchesQuery && matchesStatus
    })
    list = [...list].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'price') return dir * (a.askingPrice - b.askingPrice)
      if (sortKey === 'mileage') return dir * (a.mileage - b.mileage)
      return dir * a.purchaseDate.localeCompare(b.purchaseDate)
    })
    return list
  }, [state.vehicles, query, statusFilter, sortKey, sortDir])

  const { pageItems, controls, reset } = usePagination(filtered, 10)

  const set = (key: keyof typeof emptyForm, val: string) => setForm((f) => ({ ...f, [key]: val }))

  const submit = () => {
    setError('')
    if (!form.vin.trim() || !form.stockNumber.trim() || !form.make.trim() || !form.model.trim()) {
      setError('Stock number, VIN, make and model are required.')
      return
    }
    const vehicle: Omit<Vehicle, 'id' | 'createdAt'> = {
      stockNumber: form.stockNumber.trim(),
      vin: form.vin.trim().toUpperCase(),
      year: Number(form.year) || new Date().getFullYear(),
      make: form.make.trim(),
      model: form.model.trim(),
      trim: form.trim.trim(),
      extColor: form.extColor.trim(),
      intColor: form.intColor.trim(),
      mileage: Number(form.mileage) || 0,
      transmission: form.transmission.trim(),
      engine: form.engine.trim(),
      fuel: form.fuel.trim(),
      drivetrain: form.drivetrain.trim(),
      bodyType: form.bodyType.trim(),
      condition: form.condition,
      titleStatus: form.titleStatus,
      status: form.status,
      purchaseDate: form.purchaseDate,
      purchaseSource: form.purchaseSource,
      purchasePrice: Number(form.purchasePrice) || 0,
      auctionFees: Number(form.auctionFees) || 0,
      transportCost: Number(form.transportCost) || 0,
      askingPrice: Number(form.askingPrice) || 0,
      minPrice: Number(form.minPrice) || 0,
      photos: form.photos.split(',').map((p) => p.trim()).filter(Boolean),
      notes: form.notes.trim(),
    }
    const res = addVehicle(vehicle)
    if (!res.ok) {
      setError(res.error ?? 'Could not add vehicle.')
      return
    }
    setForm(emptyForm)
    setShowAdd(false)
    if (res.id) navigate(`/inventory/${res.id}`)
  }

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle={`${filtered.length} of ${state.vehicles.length} vehicles`}
        actions={
          <>
            <ExportButton
              filename="inventory.csv"
              rows={filtered.map((v) => ({
                stockNumber: v.stockNumber, vin: v.vin, year: v.year, make: v.make, model: v.model,
                status: v.status, mileage: v.mileage, purchaseDate: v.purchaseDate,
                purchasePrice: v.purchasePrice, askingPrice: v.askingPrice,
              }))}
            />
            <JXButton variant="contained" size="sm" onClick={() => { setError(''); setShowAdd(true) }}>
              <span className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />Add vehicle</span>
            </JXButton>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <JXTextField id="inventory-search" className="jx-text-field" label="Search VIN, stock, make or model" value={query} onChange={(v) => { setQuery(v); reset() }} placeholder="e.g. CDT-101, Toyota…" />
        </div>
        <div className="w-full sm:w-48">
          <JXSelect
            label="Status"
            className="jx-select-field jx-field-select"
            options={[{ id: 'All', label: 'All statuses' }, ...VEHICLE_STATUSES.map((s) => ({ id: s, label: s }))]}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); reset() }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Sort</span>
          <JXButtonGroup
            ariaLabel="Sort vehicles by"
            items={[{ id: 'date', label: 'Date' }, { id: 'price', label: 'Price' }, { id: 'mileage', label: 'Mileage' }]}
            activeId={sortKey}
            variant="segmented"
            size="sm"
            onChange={(id) => {
              setSortKey(id as SortKey)
              setSortDir('desc')
              reset()
            }}
          />
          <JXButton variant="outlined" size="sm" lockWidth={false} onClick={() => { setSortDir((dir) => dir === 'asc' ? 'desc' : 'asc'); reset() }}>
            {sortDir === 'desc' ? (sortKey === 'date' ? 'Newest first ↓' : 'High to low ↓') : (sortKey === 'date' ? 'Oldest first ↑' : 'Low to high ↑')}
          </JXButton>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No vehicles match"
          detail={state.vehicles.length === 0 ? 'No vehicles in the tracker yet — add your first vehicle.' : 'Try a different search or status filter.'}
          action={<JXButton variant="outlined" size="sm" lockWidth={false} onClick={() => { setQuery(''); setStatusFilter('All'); reset() }}>Clear filters</JXButton>}
        />
      ) : (
        <>
          <TableScrollHint />
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">VIN</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Mileage</th>
                  <th className="px-4 py-3 text-right">Asking price</th>
                  <th className="px-4 py-3 text-right">Days in stock</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-slate-100 hover:bg-indigo-50/60 last:border-0 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    <td className="px-4 py-3 font-mono font-semibold"><Link to={`/inventory/${v.id}`} className="rounded-sm text-indigo-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">{v.stockNumber}</Link></td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-900 dark:text-white">{v.year} {v.make} {v.model}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{v.trim} · {v.extColor}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">{v.vin}</td>
                    <td className="px-4 py-3"><StatusChip value={v.status} /></td>
                    <td className="px-4 py-3 text-right font-mono">{v.mileage.toLocaleString('en-US')}</td>
                    <td className="px-4 py-3 text-right"><Money value={v.askingPrice} /></td>
                    <td className="px-4 py-3 text-right font-mono">{daysInStock(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3">{controls}</div>
          </div>
          </>
      )}

          {showAdd && (
            <Modal title="Add vehicle" onClose={() => setShowAdd(false)} wide>
              {error && <div className="mb-4"><Alert severity="error" title="Could not add vehicle" description={error} /></div>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Stock number *"><input className={inputCls} value={form.stockNumber} onChange={(e) => set('stockNumber', e.target.value)} placeholder="CDT-115" /></Field>
                <Field label="VIN *"><input className={inputCls} value={form.vin} onChange={(e) => set('vin', e.target.value)} placeholder="17-character VIN" /></Field>
                <Field label="Year"><input className={inputCls} type="number" value={form.year} onChange={(e) => set('year', e.target.value)} /></Field>
                <Field label="Make *"><input className={inputCls} value={form.make} onChange={(e) => set('make', e.target.value)} /></Field>
                <Field label="Model *"><input className={inputCls} value={form.model} onChange={(e) => set('model', e.target.value)} /></Field>
                <Field label="Trim"><input className={inputCls} value={form.trim} onChange={(e) => set('trim', e.target.value)} /></Field>
                <Field label="Exterior color"><input className={inputCls} value={form.extColor} onChange={(e) => set('extColor', e.target.value)} /></Field>
                <Field label="Interior color"><input className={inputCls} value={form.intColor} onChange={(e) => set('intColor', e.target.value)} /></Field>
                <Field label="Mileage"><input className={inputCls} type="number" min={0} value={form.mileage} onChange={(e) => set('mileage', e.target.value)} /></Field>
                <Field label="Transmission"><input className={inputCls} value={form.transmission} onChange={(e) => set('transmission', e.target.value)} /></Field>
                <Field label="Engine"><input className={inputCls} value={form.engine} onChange={(e) => set('engine', e.target.value)} placeholder="e.g. 2.5L 4-cyl" /></Field>
                <Field label="Fuel"><input className={inputCls} value={form.fuel} onChange={(e) => set('fuel', e.target.value)} /></Field>
                <Field label="Drivetrain"><input className={inputCls} value={form.drivetrain} onChange={(e) => set('drivetrain', e.target.value)} /></Field>
                <Field label="Body type"><input className={inputCls} value={form.bodyType} onChange={(e) => set('bodyType', e.target.value)} /></Field>
                <Field label="Condition">
                  <select className={inputCls} value={form.condition} onChange={(e) => set('condition', e.target.value)}>
                    {(['Excellent', 'Good', 'Fair', 'Poor'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Title status">
                  <select className={inputCls} value={form.titleStatus} onChange={(e) => set('titleStatus', e.target.value)}>
                    {(['Clean', 'Salvage', 'Rebuilt', 'Lien', 'Missing'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Purchase source">
                  <select className={inputCls} value={form.purchaseSource} onChange={(e) => set('purchaseSource', e.target.value)}>
                    {(['Auction', 'Wholesale', 'Private seller', 'Trade-in', 'Other dealer'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Purchase date"><input className={inputCls} type="date" value={form.purchaseDate} onChange={(e) => set('purchaseDate', e.target.value)} /></Field>
                <Field label="Purchase price ($)"><input className={inputCls} type="number" min={0} step="0.01" value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)} /></Field>
                <Field label="Auction fees ($)"><input className={inputCls} type="number" min={0} step="0.01" value={form.auctionFees} onChange={(e) => set('auctionFees', e.target.value)} /></Field>
                <Field label="Transport cost ($)"><input className={inputCls} type="number" min={0} step="0.01" value={form.transportCost} onChange={(e) => set('transportCost', e.target.value)} /></Field>
                <Field label="Asking price ($)"><input className={inputCls} type="number" min={0} step="0.01" value={form.askingPrice} onChange={(e) => set('askingPrice', e.target.value)} /></Field>
                <Field label="Minimum price ($)"><input className={inputCls} type="number" min={0} step="0.01" value={form.minPrice} onChange={(e) => set('minPrice', e.target.value)} /></Field>
                <Field label="Photos" hint="Comma-separated file names, e.g. front.jpg, side.jpg">
                  <input className={inputCls} value={form.photos} onChange={(e) => set('photos', e.target.value)} />
                </Field>
                <Field label="Notes"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Duplicate VINs are rejected — the store checks the VIN against every existing vehicle.</p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <JXButton variant="text" size="sm" onClick={() => setShowAdd(false)}>Cancel</JXButton>
                <JXButton variant="contained" size="sm" onClick={submit}>Add vehicle</JXButton>
              </div>
            </Modal>
          )}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Select a stock number to open the vehicle detail page.</p>
        </>
      )
      }
