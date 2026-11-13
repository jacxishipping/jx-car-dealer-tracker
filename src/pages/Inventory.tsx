import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import {JXButtonGroup} from '../components/JXUI'
import { AppTextField as JXTextField } from "../components/AppTextField"
import { useStore } from '../store/store'
import { VEHICLE_STATUSES } from '../store/types'
import { daysInStock } from '../store/engine'
import { EmptyState, ExportButton, Money, PageHeader, StatusChip, usePagination } from '../components/ui'

import {JXButton, JXSelect} from '../components/JXUI'
type SortKey = 'price' | 'date' | 'mileage'
type InventoryView = { id: string; name: string; query: string; status: string; sortKey: SortKey; sortDir: 'asc' | 'desc' }
const SAVED_VIEWS_KEY = 'jx-dealer-inventory-views-v1'

export default function Inventory() {
  const { state } = useStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('All')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [viewName, setViewName] = useState('')
  const [activeView, setActiveView] = useState('preset:all')
  const [savedViews, setSavedViews] = useState<InventoryView[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) ?? '[]')
      return Array.isArray(value) ? value.filter((view): view is InventoryView => Boolean(view && typeof view.id === 'string' && typeof view.name === 'string' && typeof view.query === 'string' && typeof view.status === 'string' && ['price', 'date', 'mileage'].includes(view.sortKey) && ['asc', 'desc'].includes(view.sortDir))) : []
    } catch { return [] }
  })
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = state.vehicles.filter((v) => {
      const matchesQuery = !q || [v.vin, v.stockNumber, v.make, v.model].some((f) => f.toLowerCase().includes(q))
      const matchesStatus = statusFilter === 'All'
        || (statusFilter === 'Aged stock' && !['Sold', 'Wholesale', 'Returned'].includes(v.status) && daysInStock(v) > state.settings.targetHoldDays)
        || v.status === statusFilter
      return matchesQuery && matchesStatus
    })
    list = [...list].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'price') return dir * (a.askingPrice - b.askingPrice)
      if (sortKey === 'mileage') return dir * (a.mileage - b.mileage)
      return dir * a.purchaseDate.localeCompare(b.purchaseDate)
    })
    return list
  }, [state.vehicles, state.settings.targetHoldDays, query, statusFilter, sortKey, sortDir])

  const { pageItems, controls, reset } = usePagination(filtered, 10)
  const selectedVehicles = state.vehicles.filter((vehicle) => selectedIds.includes(vehicle.id))

  useEffect(() => {
    try { localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews)) } catch { /* Saved views are optional when browser storage is unavailable. */ }
  }, [savedViews])

  const applyView = (id: string) => {
    setActiveView(id)
    const view = savedViews.find((item) => item.id === id)
    if (view) {
      setQuery(view.query); setStatusFilter(view.status); setSortKey(view.sortKey); setSortDir(view.sortDir)
    } else if (id === 'preset:all') {
      setQuery(''); setStatusFilter('All'); setSortKey('date'); setSortDir('desc')
    } else if (id.startsWith('preset:')) {
      setQuery(''); setSortKey('date'); setSortDir('desc')
      setStatusFilter(id === 'preset:available' ? 'Available' : id === 'preset:recon' ? 'In reconditioning' : id === 'preset:aged' ? 'Aged stock' : 'All')
    }
    reset(); setSelectedIds([])
  }

  const saveCurrentView = () => {
    const name = viewName.trim()
    if (!name) return
    const id = `view-${Date.now()}`
    setSavedViews((views) => [...views.filter((view) => view.name.toLowerCase() !== name.toLowerCase()), {
      id, name, query, status: statusFilter, sortKey, sortDir,
    }])
    setActiveView(id)
    setViewName('')
  }

  const agedViewCount = state.vehicles.filter((vehicle) => !['Sold', 'Wholesale', 'Returned'].includes(vehicle.status) && daysInStock(vehicle) > state.settings.targetHoldDays).length
  const viewOptions = [
    { id: 'preset:all', label: 'All inventory' },
    { id: 'preset:available', label: 'Available' },
    { id: 'preset:aged', label: `Aged stock (${agedViewCount})` },
    { id: 'preset:recon', label: 'Needs reconditioning' },
    ...savedViews.map((view) => ({ id: view.id, label: `Saved: ${view.name}` })),
  ]

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
            <JXButton variant="contained" size="sm" onClick={() => navigate('/inventory/new')}>
              <span className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />Add vehicle</span>
            </JXButton>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-60">
          <JXSelect label="Inventory view" className="jx-select-field jx-field-select" options={viewOptions} value={activeView} placeholder="Choose a saved view" onChange={applyView} />
        </div>
        <div className="flex min-w-56 flex-1 gap-2">
          <label className="sr-only" htmlFor="inventory-view-name">Name this view</label>
          <JXTextField id="inventory-view-name" className="jx-text-field" label="" value={viewName} onChange={setViewName} placeholder="Name current view…" />
          <JXButton variant="outlined" size="sm" lockWidth={false} disabled={!viewName.trim()} onClick={saveCurrentView}>Save view</JXButton>
          {activeView.startsWith('view-') && <JXButton variant="text" size="sm" lockWidth={false} aria-label="Delete selected saved view" onClick={() => { setSavedViews((views) => views.filter((view) => view.id !== activeView)); setActiveView('preset:all') }}><Trash2 className="h-4 w-4" /><span className="sr-only">Delete view</span></JXButton>}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <JXTextField id="inventory-search" className="jx-text-field" label="Search VIN, stock, make or model" value={query} onChange={(v) => { setQuery(v); setActiveView(''); reset(); setSelectedIds([]) }} placeholder="e.g. CDT-101, Toyota…" />
        </div>
        <div className="w-full sm:w-48">
          <JXSelect
            label="Status"
            className="jx-select-field jx-field-select"
            options={[{ id: 'All', label: 'All statuses' }, { id: 'Aged stock', label: `Aged stock (${agedViewCount})` }, ...VEHICLE_STATUSES.map((s) => ({ id: s, label: s }))]}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setActiveView(''); reset(); setSelectedIds([]) }}
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
              setActiveView('')
              reset()
            }}
          />
          <JXButton variant="outlined" size="sm" lockWidth={false} onClick={() => { setSortDir((dir) => dir === 'asc' ? 'desc' : 'asc'); setActiveView(''); reset() }}>
            {sortDir === 'desc' ? (sortKey === 'date' ? 'Newest first ↓' : 'High to low ↓') : (sortKey === 'date' ? 'Oldest first ↑' : 'Low to high ↑')}
          </JXButton>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No vehicles match"
          detail={state.vehicles.length === 0 ? 'No vehicles in the tracker yet — add your first vehicle.' : 'Try a different search or status filter.'}
          action={<JXButton variant="outlined" size="sm" lockWidth={false} onClick={() => { setQuery(''); setStatusFilter('All'); setActiveView('preset:all'); setSelectedIds([]); reset() }}>Clear filters</JXButton>}
        />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" aria-label="Select all vehicles on this page" checked={pageItems.length > 0 && pageItems.every((vehicle) => selectedIds.includes(vehicle.id))} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...new Set([...ids, ...pageItems.map((vehicle) => vehicle.id)])] : ids.filter((id) => !pageItems.some((vehicle) => vehicle.id === id)))} />
              Select this page
            </label>
            {selectedVehicles.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-slate-600 dark:text-slate-300">{selectedVehicles.length} selected</span><ExportButton filename="selected-vehicles.csv" label="Export selected" rows={selectedVehicles.map((v) => ({ stockNumber: v.stockNumber, vin: v.vin, year: v.year, make: v.make, model: v.model, status: v.status, mileage: v.mileage, askingPrice: v.askingPrice }))} /><JXButton variant="text" size="sm" lockWidth={false} onClick={() => setSelectedIds([])}>Clear selection</JXButton></div>}
          </div>
          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)] xl:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-3 py-3"><span className="sr-only">Select</span></th>
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
                    <td className="px-3 py-3"><input type="checkbox" aria-label={`Select ${v.stockNumber}`} checked={selectedIds.includes(v.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, v.id] : ids.filter((id) => id !== v.id))} /></td>
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
          <div className="space-y-2 xl:hidden">
            {pageItems.map((vehicle) => (
              <article key={vehicle.id} className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><Link to={`/inventory/${vehicle.id}`} className="font-mono text-sm font-semibold text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300">{vehicle.stockNumber}</Link><p className="mt-0.5 truncate font-medium text-slate-900 dark:text-white">{vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim}</p><p className="truncate text-xs text-slate-500 dark:text-slate-400">VIN {vehicle.vin}</p></div>
                  <label className="flex min-h-11 min-w-11 items-center justify-center"><input type="checkbox" aria-label={`Select ${vehicle.stockNumber}`} checked={selectedIds.includes(vehicle.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, vehicle.id] : ids.filter((id) => id !== vehicle.id))} /></label>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-sm dark:border-slate-700"><StatusChip value={vehicle.status} /><span className="font-mono font-semibold"><Money value={vehicle.askingPrice} /></span><span className="text-xs text-slate-500 dark:text-slate-400">{vehicle.mileage.toLocaleString('en-US')} mi · {daysInStock(vehicle)} days</span></div>
              </article>
            ))}
            <div className="px-1">{controls}</div>
          </div>
          </>
      )}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Select a stock number to open the vehicle detail page.</p>
        </>
      )
      }
