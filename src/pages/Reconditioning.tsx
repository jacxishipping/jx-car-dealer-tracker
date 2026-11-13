// Reconditioning — recon jobs grouped by vehicle, with the vehicle's linked
// expenses shown alongside each group. Jobs can be created and advanced
// from this page via the store's addReconJob / updateReconJob actions;
// costs are recorded as linked Direct expenses (recordExpense).
import { useMemo, useState } from 'react'
import { JXButton, JXCard, JXProgress, JXSelect } from '@jacxishippingorg/jx-ui-react'
import { Plus, Wrench } from 'lucide-react'
import { useStore } from '../store/store'
import { EXPENSE_CATEGORIES, fmtMoney, type ExpenseCategory, type ReconJob } from '../store/types'
import {
  Alert, EmptyState, Field, inputCls, KpiCard, Modal,
  Money, PageHeader, selectCls, StatusChip, TableScrollHint,
} from '../components/ui'

const today = () => new Date().toISOString().slice(0, 10)
const num = (v: string) => (v === '' ? 0 : Number(v))

const JOB_STATUSES: ReconJob['status'][] = ['Not started', 'In progress', 'Done']

export default function Reconditioning() {
  const { state, recordExpense, addReconJob, updateReconJob } = useStore()
  const [statusFilter, setStatusFilter] = useState('All')
  const [expenseJob, setExpenseJob] = useState<ReconJob | null>(null)
  const [newJobOpen, setNewJobOpen] = useState(false)
  const [nf, setNf] = useState({ vehicleId: '', title: '', category: 'Mechanical repairs' as ExpenseCategory, technician: '', estimatedCost: '', notes: '' })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const vehicleById = useMemo(() => new Map(state.vehicles.map((v) => [v.id, v])), [state.vehicles])

  const jobs = useMemo(
    () => state.reconJobs.filter((j) => statusFilter === 'All' || j.status === statusFilter),
    [state.reconJobs, statusFilter],
  )

  // Group (filtered) jobs by vehicle, vehicles in stock-number order.
  const groups = useMemo(() => {
    const map = new Map<string, ReconJob[]>()
    for (const j of jobs) {
      const list = map.get(j.vehicleId) ?? []
      list.push(j)
      map.set(j.vehicleId, list)
    }
    return [...map.entries()]
      .map(([vehicleId, list]) => ({ vehicle: vehicleById.get(vehicleId), vehicleId, jobs: list }))
      .sort((a, b) => (a.vehicle?.stockNumber ?? '').localeCompare(b.vehicle?.stockNumber ?? ''))
  }, [jobs, vehicleById])

  const expensesByVehicle = useMemo(() => {
    const map = new Map<string, typeof state.expenses>()
    for (const e of state.expenses) {
      if (!e.vehicleId) continue
      const list = map.get(e.vehicleId) ?? []
      list.push(e)
      map.set(e.vehicleId, list)
    }
    return map
  }, [state.expenses])

  const count = (s: ReconJob['status']) => state.reconJobs.filter((j) => j.status === s).length
  const totalEst = state.reconJobs.reduce((s, j) => s + j.estimatedCost, 0)
  const totalActual = state.reconJobs.reduce((s, j) => s + j.actualCost, 0)
  const linkedExpenseTotal = groups.reduce(
    (s, g) => s + (expensesByVehicle.get(g.vehicleId) ?? []).reduce((a, e) => a + e.amount, 0), 0)

  // ---- "Record cost as expense" form (per job) ----
  const [f, setF] = useState({ amount: '', description: '', vendor: '', date: today(), status: 'Paid' as 'Paid' | 'Pending', invoiceRef: '', notes: '' })
  const openExpense = (job: ReconJob) => {
    setError(null)
    setExpenseJob(job)
    setF({
      amount: String(job.actualCost > 0 ? job.actualCost : job.estimatedCost),
      description: `${job.title} — ${vehicleById.get(job.vehicleId)?.stockNumber ?? ''}`,
      vendor: '', date: today(), status: 'Paid', invoiceRef: '', notes: job.notes,
    })
  }
  const submitExpense = () => {
    if (!expenseJob) return
    if (!f.amount || num(f.amount) <= 0) { setError('Enter a positive amount.'); return }
    const v = vehicleById.get(expenseJob.vehicleId)
    recordExpense({
      description: f.description.trim() || expenseJob.title,
      amount: num(f.amount),
      category: expenseJob.category as ExpenseCategory,
      date: f.date || today(),
      vendor: f.vendor.trim() || '—',
      vehicleId: expenseJob.vehicleId,
      kind: 'Direct',
      paymentMethod: 'Bank transfer',
      status: f.status,
      invoiceRef: f.invoiceRef.trim(),
      createdBy: state.currentUser,
      notes: f.notes.trim(),
    })
    setSuccess(`Cost recorded as a Direct expense for ${v?.stockNumber ?? ''}: ${f.description.trim()} (${fmtMoney(num(f.amount))}).`)
    setExpenseJob(null)
  }

  // ---- "New job" form ----
  const openNewJob = () => {
    setError(null)
    setNf({ vehicleId: state.vehicles[0]?.id ?? '', title: '', category: 'Mechanical repairs', technician: '', estimatedCost: '', notes: '' })
    setNewJobOpen(true)
  }
  const submitNewJob = () => {
    if (!nf.vehicleId) { setError('Pick a vehicle.'); return }
    if (!nf.title.trim()) { setError('Enter a job title.'); return }
    if (!nf.estimatedCost || num(nf.estimatedCost) < 0) { setError('Enter an estimated cost of 0 or more.'); return }
    addReconJob({
      vehicleId: nf.vehicleId,
      title: nf.title.trim(),
      category: nf.category,
      status: 'Not started',
      technician: nf.technician.trim() || 'Unassigned',
      estimatedCost: num(nf.estimatedCost),
      actualCost: 0,
      startedAt: today(),
      completedAt: null,
      notes: nf.notes.trim(),
    })
    const v = vehicleById.get(nf.vehicleId)
    setSuccess(`Recon job "${nf.title.trim()}" created for ${v?.stockNumber ?? ''}.`)
    setNewJobOpen(false)
  }

  // Advance a job one step: Not started → In progress → Done.
  const advance = (j: ReconJob) => {
    if (j.status === 'Not started') {
      updateReconJob(j.id, { status: 'In progress', startedAt: today() })
      setSuccess(`Job "${j.title}" started.`)
    } else if (j.status === 'In progress') {
      updateReconJob(j.id, { status: 'Done', completedAt: today() })
      setSuccess(`Job "${j.title}" marked done.`)
    }
  }

  return (
    <>
      <PageHeader
        title="Reconditioning"
        subtitle={`${state.reconJobs.length} recon jobs across ${groups.length} vehicle${groups.length === 1 ? '' : 's'} — create jobs, advance their status, and record costs as linked expenses.`}
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Jobs" value={String(state.reconJobs.length)} sub={`${count('Done')} done · ${count('In progress')} in progress · ${count('Not started')} not started`} />
        <KpiCard label="Estimated cost" value={fmtMoney(totalEst)} tone="sky" />
        <KpiCard label="Actual cost (jobs)" value={fmtMoney(totalActual)} tone="amber" />
        <KpiCard label="Linked expenses" value={fmtMoney(linkedExpenseTotal)} sub="All expenses on these vehicles" tone="emerald" />
        <KpiCard label="Over / under estimate" value={fmtMoney(totalActual - totalEst)} sub={totalActual > totalEst ? 'Actual above estimate' : 'Actual within estimate'} tone={totalActual > totalEst ? 'rose' : 'emerald'} />
      </div>

      {success && <div className="mb-4"><Alert severity="success" title="Done" description={success} /></div>}

      <div className="mb-4 flex flex-wrap gap-3">
          <JXSelect label="Filter by job status" className="jx-select-field jx-sr-label w-full sm:w-auto" value={statusFilter} onChange={setStatusFilter} options={[{ id: 'All', label: 'All statuses' }, ...JOB_STATUSES.map((status) => ({ id: status, label: status }))]} />
          <JXButton variant="contained" size="sm" lockWidth={false} onClick={openNewJob}>
            <span className="inline-flex items-center gap-1"><Plus className="h-4 w-4" />New job</span>
          </JXButton>
      </div>

      {groups.length === 0 ? (
        <EmptyState title="No recon jobs found" detail="No jobs match this status filter, or no recon jobs exist yet." />
      ) : (
        <div className="space-y-5">
          {groups.map(({ vehicle, vehicleId, jobs: vJobs }) => {
            const expenses = expensesByVehicle.get(vehicleId) ?? []
            const est = vJobs.reduce((s, j) => s + j.estimatedCost, 0)
            const actual = vJobs.reduce((s, j) => s + j.actualCost, 0)
            const expTotal = expenses.reduce((s, e) => s + e.amount, 0)
            return (
              <JXCard
                key={vehicleId}
                title={vehicle ? `${vehicle.stockNumber} — ${vehicle.year} ${vehicle.make} ${vehicle.model}` : `Vehicle ${vehicleId}`}
                kicker={vehicle?.status ?? ''}
                description={vehicle ? `${vehicle.vin} · ${vehicle.mileage.toLocaleString()} km · ${vehicle.extColor}` : undefined}
                className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]"
              >
                <div className="p-4">
                    <div className="mb-3 flex flex-wrap gap-4 text-sm text-slate-500 dark:text-slate-400">
                      <span>Jobs: <strong className="text-slate-900 dark:text-white">{vJobs.length}</strong></span>
                      <span>Estimated: <Money value={est} className="text-slate-900 dark:text-white" /></span>
                      <span>Actual (jobs): <Money value={actual} className="text-slate-900 dark:text-white" /></span>
                      <span>Linked expenses: <Money value={expTotal} className="text-slate-900 dark:text-white" /></span>
                    </div>

                    <TableScrollHint />
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                              <th className="px-3 py-2">Job</th><th className="px-3 py-2">Category</th>
                              <th className="px-3 py-2">Technician</th><th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2 text-right">Estimated</th><th className="px-3 py-2 text-right">Actual</th>
                              <th className="px-3 py-2">Dates</th><th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                          {vJobs.map((j) => (
                          <tr key={j.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700">
                            <td className="px-3 py-2">
                              <p className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                                <Wrench className="h-4 w-4 text-slate-500 dark:text-slate-400" />{j.title}
                              </p>
                              <JXProgress value={j.status === 'Done' ? 100 : j.status === 'In progress' ? 50 : 0} label={j.status} />
                              {j.notes && <p className="text-xs text-slate-500 dark:text-slate-400">{j.notes}</p>}
                            </td>
                            <td className="px-3 py-2">{j.category}</td>
                            <td className="px-3 py-2">{j.technician}</td>
                            <td className="px-3 py-2"><StatusChip value={j.status} /></td>
                            <td className="px-3 py-2 text-right"><Money value={j.estimatedCost} /></td>
                            <td className="px-3 py-2 text-right"><Money value={j.actualCost} /></td>
                            <td className="px-3 py-2 whitespace-nowrap text-xs">
                              <p>Started {j.startedAt}</p>
                              <p className="text-slate-500 dark:text-slate-400">{j.completedAt ? `Done ${j.completedAt}` : 'Not completed'}</p>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex flex-wrap justify-end gap-2">
                                {j.status !== 'Done' && (
                                  <JXButton variant="soft" size="sm" lockWidth={false} onClick={() => advance(j)}>
                                    {j.status === 'Not started' ? 'Start' : 'Mark done'}
                                  </JXButton>
                                )}
                                <JXButton variant="outlined" size="sm" lockWidth={false} onClick={() => openExpense(j)}>
                                  <span className="inline-flex items-center gap-1"><Plus className="h-4 w-4" />Record cost</span>
                                </JXButton>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Linked expenses for this vehicle ({expenses.length})</p>
                    {expenses.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">No expenses linked to this vehicle yet.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
                        {[...expenses].sort((a, b) => b.date.localeCompare(a.date)).map((e) => (
                          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <span>
                              <span className="font-medium text-slate-900 dark:text-white">{e.description}</span>
                              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{e.date} · {e.category} · {e.vendor}{e.invoiceRef ? ` · ${e.invoiceRef}` : ''}</span>
                            </span>
                            <span className="flex items-center gap-2">
                              <StatusChip value={e.status} />
                              <Money value={e.amount} className="font-semibold" />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </JXCard>
                        )
          })}
                    </div>
      )}

                    {newJobOpen && (
                      <Modal title="New recon job" onClose={() => setNewJobOpen(false)}>
                        {error && <div className="mb-4"><Alert severity="error" title="Could not create job" description={error} /></div>}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <Field label="Vehicle *">
                            <select className={selectCls} value={nf.vehicleId} onChange={(e) => setNf((p) => ({ ...p, vehicleId: e.target.value }))}>
                              {state.vehicles.map((v) => (
                                <option key={v.id} value={v.id}>{v.stockNumber} — {v.year} {v.make} {v.model}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Job title *"><input className={inputCls} value={nf.title} onChange={(e) => setNf((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Brake service" /></Field>
                          <Field label="Category">
                            <select className={selectCls} value={nf.category} onChange={(e) => setNf((p) => ({ ...p, category: e.target.value as ExpenseCategory }))}>
                              {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                            </select>
                          </Field>
                          <Field label="Technician"><input className={inputCls} value={nf.technician} onChange={(e) => setNf((p) => ({ ...p, technician: e.target.value }))} placeholder="e.g. M. Rahimi" /></Field>
                          <Field label="Estimated cost (USD) *"><input type="number" min="0" step="0.01" className={inputCls} value={nf.estimatedCost} onChange={(e) => setNf((p) => ({ ...p, estimatedCost: e.target.value }))} /></Field>
                          <Field label="Notes"><input className={inputCls} value={nf.notes} onChange={(e) => setNf((p) => ({ ...p, notes: e.target.value }))} /></Field>
                        </div>
                        <div className="mt-5 flex flex-wrap justify-end gap-2">
                          <JXButton variant="outlined" size="sm" onClick={() => setNewJobOpen(false)}>Cancel</JXButton>
                          <JXButton variant="contained" size="sm" onClick={submitNewJob}>Create job</JXButton>
                        </div>
                      </Modal>
                    )}

                    {expenseJob && (
                      <Modal
                        title={`Record cost as expense — ${expenseJob.title} (${vehicleById.get(expenseJob.vehicleId)?.stockNumber ?? ''})`}
                        onClose={() => setExpenseJob(null)}
                      >
                        {error && <div className="mb-4"><Alert severity="error" title="Could not record expense" description={error} /></div>}
                        <p className="mb-4 text-sm text-slate-500">
                          This creates a Direct expense in the {expenseJob.category} category, linked to this vehicle.
                          It does not change the recon job itself.
                        </p>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <Field label="Description"><input className={inputCls} value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} /></Field>
                          <Field label="Amount (USD) *"><input type="number" min="0" step="0.01" className={inputCls} value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} /></Field>
                          <Field label="Vendor"><input className={inputCls} value={f.vendor} onChange={(e) => setF((p) => ({ ...p, vendor: e.target.value }))} placeholder="e.g. AutoFix Garage" /></Field>
                          <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF((p) => ({ ...p, date: e.target.value }))} /></Field>
                          <Field label="Payment status">
                            <select className={selectCls} value={f.status} onChange={(e) => setF((p) => ({ ...p, status: e.target.value as 'Paid' | 'Pending' }))}>
                              <option value="Paid">Paid</option>
                              <option value="Pending">Pending</option>
                            </select>
                          </Field>
                          <Field label="Invoice ref"><input className={inputCls} value={f.invoiceRef} onChange={(e) => setF((p) => ({ ...p, invoiceRef: e.target.value }))} placeholder="e.g. INV-AF-771" /></Field>
                          <Field label="Notes"><input className={inputCls} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} /></Field>
                        </div>
                        <div className="mt-5 flex flex-wrap justify-end gap-2">
                          <JXButton variant="outlined" size="sm" onClick={() => setExpenseJob(null)}>Cancel</JXButton>
                          <JXButton variant="contained" size="sm" onClick={submitExpense}>Record expense</JXButton>
                        </div>
                      </Modal>
                    )}
                  </>
                  )
}
