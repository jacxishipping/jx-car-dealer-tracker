// Expenses — filterable expense ledger with direct/overhead totals and CSV export.
import { useMemo, useState } from 'react'
import { JXButton, JXSelect } from '@jacxishippingorg/jx-ui-react'
import { AppTextField as JXTextField } from "../components/AppTextField"
import { Plus } from 'lucide-react'
import { useStore } from '../store/store'
import { EXPENSE_CATEGORIES, fmtMoney, type Expense, type ExpenseCategory } from '../store/types'
import {
  Alert, EmptyState, ExportButton, Field, inputCls, KpiCard, Modal,
  Money, PageHeader, selectCls, StatusChip, TableScrollHint, usePagination,
} from '../components/ui'

const today = () => new Date().toISOString().slice(0, 10)
const num = (v: string) => (v === '' ? 0 : Number(v))

export default function Expenses() {
  const { state, recordExpense } = useStore()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [catFilter, setCatFilter] = useState('All')
  const [kindFilter, setKindFilter] = useState<'All' | 'Direct' | 'Overhead'>('All')
  const [vehicleFilter, setVehicleFilter] = useState('All')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [search, setSearch] = useState('')

  const vehicleById = useMemo(() => new Map(state.vehicles.map((v) => [v.id, v])), [state.vehicles])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = state.expenses.filter((e) =>
      (catFilter === 'All' || e.category === catFilter) &&
      (kindFilter === 'All' || e.kind === kindFilter) &&
      (vehicleFilter === 'All'
        ? true
        : vehicleFilter === 'overhead' ? e.vehicleId === null : e.vehicleId === vehicleFilter) &&
      (!q || [e.description, e.vendor, e.invoiceRef, e.notes, e.category,
      vehicleById.get(e.vehicleId ?? '')?.stockNumber].join(' ').toLowerCase().includes(q)))
    return rows.sort((a, b) => sort === 'newest'
      ? b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
      : a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  }, [state.expenses, catFilter, kindFilter, vehicleFilter, sort, search, vehicleById])

  const { pageItems, controls } = usePagination(filtered, 10)

  const sum = (rows: Expense[]) => rows.reduce((s, e) => s + e.amount, 0)
  const total = sum(state.expenses)
  const direct = sum(state.expenses.filter((e) => e.kind === 'Direct'))
  const overhead = sum(state.expenses.filter((e) => e.kind === 'Overhead'))
  const paid = sum(state.expenses.filter((e) => e.status === 'Paid'))
  const pending = sum(state.expenses.filter((e) => e.status === 'Pending'))

  // ---- Record expense form ----
  const [f, setF] = useState({
    description: '', amount: '', category: 'Mechanical repairs' as ExpenseCategory,
    date: today(), vendor: '', vehicleId: '', kind: 'Direct' as 'Direct' | 'Overhead',
    paymentMethod: 'Bank transfer', status: 'Paid' as 'Paid' | 'Pending',
    invoiceRef: '', notes: '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }))

  const submit = () => {
    setError(null)
    if (!f.description.trim() || !f.amount || num(f.amount) <= 0) {
      setError('A description and a positive amount are required.')
      return
    }
    recordExpense({
      description: f.description.trim(),
      amount: num(f.amount),
      category: f.category,
      date: f.date || today(),
      vendor: f.vendor.trim() || '—',
      vehicleId: f.vehicleId || null,
      kind: f.vehicleId ? f.kind : 'Overhead',
      paymentMethod: f.paymentMethod,
      status: f.status,
      invoiceRef: f.invoiceRef.trim(),
      createdBy: state.currentUser,
      notes: f.notes.trim(),
    })
    setSuccess(`Expense recorded — ${f.description.trim()} (${fmtMoney(num(f.amount))}).${f.status === 'Paid' ? ' Payment and journal entry posted.' : ' Left pending.'}`)
    setOpen(false)
    setF({ ...f, description: '', amount: '', vendor: '', invoiceRef: '', notes: '', vehicleId: '' })
  }

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle={`${state.expenses.length} expenses — direct costs attach to a vehicle, the rest is general overhead.`}
        actions={
          <>
            <ExportButton filename="expenses.csv" rows={filtered.map((e) => ({
              Date: e.date, Description: e.description, Category: e.category, Kind: e.kind,
              Vehicle: e.vehicleId ? (vehicleById.get(e.vehicleId)?.stockNumber ?? '') : 'General overhead',
              Vendor: e.vendor, Amount: e.amount, PaymentMethod: e.paymentMethod,
              Status: e.status, InvoiceRef: e.invoiceRef, Notes: e.notes,
            }))} />
            <JXButton variant="contained" size="sm" onClick={() => { setError(null); setOpen(true) }}>
              <span className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />Record expense</span>
            </JXButton>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Total expenses" value={fmtMoney(total)} sub={`${state.expenses.length} records`} />
        <KpiCard label="Direct (vehicles)" value={fmtMoney(direct)} tone="sky" />
        <KpiCard label="Overhead" value={fmtMoney(overhead)} tone="amber" />
        <KpiCard label="Paid" value={fmtMoney(paid)} tone="emerald" />
        <KpiCard label="Pending" value={fmtMoney(pending)} tone="rose" />
      </div>

      {success && <div className="mb-4"><Alert severity="success" title="Expense recorded" description={success} /></div>}

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-full sm:w-56">
          <JXSelect
            label="Filter by category"
            className="jx-select-field jx-sr-label"
            options={[{ id: 'All', label: 'All categories' }, ...EXPENSE_CATEGORIES.map((c) => ({ id: c, label: c }))]}
            value={catFilter} onChange={setCatFilter} placeholder="Category" searchable
          />
        </div>
        <div className="w-full sm:w-auto"><JXSelect label="Direct or overhead" className="jx-select-field jx-sr-label w-full sm:w-auto" value={kindFilter} onChange={(value) => setKindFilter(value as typeof kindFilter)} options={[{ id: 'All', label: 'Direct + Overhead' }, { id: 'Direct', label: 'Direct only' }, { id: 'Overhead', label: 'Overhead only' }]} /></div>
        <div className="max-w-full"><JXSelect label="Filter by vehicle" className="jx-select-field jx-sr-label w-full sm:w-auto max-w-full" value={vehicleFilter} onChange={setVehicleFilter} options={[{ id: 'All', label: 'All vehicles' }, { id: 'overhead', label: 'General overhead (no vehicle)' }, ...state.vehicles.map((v) => ({ id: v.id, label: `${v.stockNumber} — ${v.year} ${v.make} ${v.model}` }))]} searchable /></div>
        <div className="w-full sm:w-auto"><JXSelect label="Sort by date" className="jx-select-field jx-sr-label w-full sm:w-auto" value={sort} onChange={(value) => setSort(value as typeof sort)} options={[{ id: 'newest', label: 'Newest first' }, { id: 'oldest', label: 'Oldest first' }]} /></div>
        <div className="w-full sm:max-w-xs flex-1 min-w-52">
          <JXTextField id="expenses-search" aria-label="Search expenses by description, vendor, or invoice" className="jx-text-field" label="" placeholder="Search description, vendor, invoice…" value={search} onChange={setSearch} />
        </div>
      </div>

        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          Showing {filtered.length} expense{filtered.length === 1 ? '' : 's'} totalling <Money value={sum(filtered)} className="font-semibold text-slate-900 dark:text-white" />.
        </p>

        {filtered.length === 0 ? (
        <EmptyState title="No expenses match" detail="Adjust the filters, or record an expense." action={<JXButton variant="contained" size="sm" lockWidth={false} onClick={() => setOpen(true)}>Record expense</JXButton>} />
        ) : (
        <>
          <TableScrollHint />
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-4 py-3">Date</th><th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Category</th><th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Vendor</th><th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Payment</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((e) => {
                  const v = e.vehicleId ? vehicleById.get(e.vehicleId) : undefined
                  return (
                    <tr key={e.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700">
                      <td className="px-4 py-3 whitespace-nowrap">{e.date}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 dark:text-white">{e.description}</p>
                        {e.notes && <p className="text-xs text-slate-500 dark:text-slate-400">{e.notes}</p>}
                      </td>
                      <td className="px-4 py-3">{e.category}<p className="text-xs text-slate-500 dark:text-slate-400">{e.kind}</p></td>
                      <td className="px-4 py-3">{v ? <span className="font-mono">{v.stockNumber}</span> : <span className="text-slate-500 dark:text-slate-400">General overhead</span>}</td>
                      <td className="px-4 py-3">{e.vendor}</td>
                      <td className="px-4 py-3 text-right font-semibold"><Money value={e.amount} /></td>
                      <td className="px-4 py-3">{e.paymentMethod}</td>
                      <td className="px-4 py-3"><StatusChip value={e.status} /></td>
                      <td className="px-4 py-3 font-mono text-xs">{e.invoiceRef || '—'}</td>
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
          <Modal title="Record expense" onClose={() => setOpen(false)} wide>
            {error && <div className="mb-4"><Alert severity="error" title="Could not record expense" description={error} /></div>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Description *"><input className={inputCls} value={f.description} onChange={set('description')} placeholder="e.g. Brake pads + labour — CDT-103" /></Field>
              <Field label="Amount (USD) *"><input type="number" min="0" step="0.01" className={inputCls} value={f.amount} onChange={set('amount')} placeholder="0.00" /></Field>
              <JXSelect
                label="Category"
                className="jx-select-field jx-field-select"
                options={EXPENSE_CATEGORIES.map((c) => ({ id: c, label: c }))}
                value={f.category} onChange={(v) => setF((p) => ({ ...p, category: v as ExpenseCategory }))}
                placeholder="Select category" searchable
              />
              <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={set('date')} /></Field>
              <Field label="Vendor"><input className={inputCls} value={f.vendor} onChange={set('vendor')} placeholder="e.g. AutoFix Garage" /></Field>
              <Field label="Vehicle (optional — leave blank for general overhead)">
                <select className={selectCls} value={f.vehicleId} onChange={set('vehicleId')}>
                  <option value="">General overhead — no vehicle</option>
                  {state.vehicles.map((v) => <option key={v.id} value={v.id}>{v.stockNumber} — {v.year} {v.make} {v.model}</option>)}
                </select>
              </Field>
              <Field label="Kind" hint={f.vehicleId ? 'Direct costs attach to the vehicle.' : 'No vehicle selected, so this is recorded as Overhead.'}>
                <select className={selectCls} value={f.kind} onChange={(e) => setF((p) => ({ ...p, kind: e.target.value as 'Direct' | 'Overhead' }))} disabled={!f.vehicleId}>
                  <option value="Direct">Direct</option>
                  <option value="Overhead">Overhead</option>
                </select>
              </Field>
              <Field label="Payment method">
                <select className={selectCls} value={f.paymentMethod} onChange={set('paymentMethod')}>
                  {['Bank transfer', 'Cash', 'Card', 'Floorplan'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Payment status">
                <select className={selectCls} value={f.status} onChange={(e) => setF((p) => ({ ...p, status: e.target.value as 'Paid' | 'Pending' }))}>
                  <option value="Paid">Paid</option>
                  <option value="Pending">Pending</option>
                </select>
              </Field>
              <Field label="Invoice ref"><input className={inputCls} value={f.invoiceRef} onChange={set('invoiceRef')} placeholder="e.g. INV-AF-771" /></Field>
              <Field label="Notes"><input className={inputCls} value={f.notes} onChange={set('notes')} placeholder="Optional note" /></Field>
            </div>
              <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                Paid expenses also post a payment transaction and journal entry. Recorded by {state.currentUser}.
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <JXButton variant="outlined" size="sm" onClick={() => setOpen(false)}>Cancel</JXButton>
                <JXButton variant="contained" size="sm" onClick={submit}>Record expense</JXButton>
              </div>
          </Modal>
        )}
      </>
      )
}
