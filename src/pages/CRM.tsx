import { useMemo, useState } from 'react'
import { JXButton, JXCard, JXChip, JXSelect } from '@jacxishippingorg/jx-ui-react'
import { AppTextField as JXTextField } from "../components/AppTextField"
import { useStore } from '../store/store'
import { LEAD_STAGES, fmtMoney, type LeadStage } from '../store/types'
import { Alert, EmptyState, Field, inputCls, KpiCard, Modal, Money, PageHeader, StatusChip, TableScrollHint, usePagination } from '../components/ui'

const today = new Date().toISOString().slice(0, 10)
const isOverdue = (followUpDate: string, stage: LeadStage) =>
  followUpDate < today && stage !== 'Sold' && stage !== 'Lost'

export default function CRM() {
  const { state, addCustomer, moveLead, addInteraction, addOffer } = useStore()
  const { customers, leads, interactions, offers, vehicles, currentUser } = state
  const [search, setSearch] = useState('')
  const [salesFilter, setSalesFilter] = useState('All')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  // New customer form
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [pref, setPref] = useState<'Phone' | 'Email' | 'WhatsApp'>('Phone')
  const [budget, setBudget] = useState('')
  const [leadSource, setLeadSource] = useState('Walk-in')
  const [salesperson, setSalesperson] = useState(currentUser)
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')

  // Interaction + offer forms (lead/customer detail)
  const [ixType, setIxType] = useState<'Call' | 'Email' | 'WhatsApp' | 'Visit' | 'Test drive'>('Call')
  const [ixNotes, setIxNotes] = useState('')
  const [offerVehicleId, setOfferVehicleId] = useState('')
  const [offerAmount, setOfferAmount] = useState('')
  const [offerError, setOfferError] = useState('')

  const salespeople = useMemo(() => [...new Set(customers.map((c) => c.salesperson))].sort(), [customers])
  const filteredCustomers = customers.filter((c) => {
    const q = search.trim().toLowerCase()
    const matches = !q || [c.name, c.phone, c.email, c.address, c.notes, c.leadSource].some((x) => x.toLowerCase().includes(q))
    return matches && (salesFilter === 'All' || c.salesperson === salesFilter)
  })
  const { pageItems, controls } = usePagination(filteredCustomers, 8)
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null
  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null
  const leadCustomer = selectedLead ? customers.find((c) => c.id === selectedLead.customerId) : null
  // Detail subject: lead's customer if a lead is selected, else the selected customer
  const detailCustomer = leadCustomer ?? selectedCustomer
  const detailInteractions = detailCustomer ? interactions.filter((i) => i.customerId === detailCustomer.id) : []
  const detailOffers = detailCustomer ? offers.filter((o) => o.customerId === detailCustomer.id) : []
  const detailLeads = detailCustomer ? leads.filter((l) => l.customerId === detailCustomer.id) : []
  const overdueCount = leads.filter((l) => isOverdue(l.followUpDate, l.stage)).length
  const activeLeads = leads.filter((l) => l.stage !== 'Sold' && l.stage !== 'Lost').length

  const submitCustomer = () => {
    if (!name.trim()) { setFormError('Name is required.'); return }
    const id = addCustomer({
      name: name.trim(), phone: phone.trim(), email: email.trim(), address: address.trim(),
      preferredContact: pref, budget: parseFloat(budget) || 0, leadSource, salesperson: salesperson || currentUser,
      notes: notes.trim(), interestedVehicleIds: [],
    })
    setSelectedCustomerId(id); setShowNew(false)
    setName(''); setPhone(''); setEmail(''); setAddress(''); setBudget(''); setNotes(''); setFormError('')
  }

  const logInteraction = () => {
    if (!detailCustomer || !ixNotes.trim()) return
    addInteraction(detailCustomer.id, ixType, ixNotes.trim())
    setIxNotes('')
  }

  const submitOffer = () => {
    if (!detailCustomer) return
    if (!offerVehicleId) { setOfferError('Select a vehicle for the offer.'); return }
    const amt = parseFloat(offerAmount)
    if (!Number.isFinite(amt) || amt <= 0) { setOfferError('Offer amount must be greater than zero.'); return }
    addOffer(offerVehicleId, detailCustomer.id, amt)
    setOfferAmount(''); setOfferVehicleId(''); setOfferError('')
  }

  const move = (leadId: string, dir: -1 | 1) => {
    const lead = leads.find((l) => l.id === leadId)
    if (!lead) return
    const idx = LEAD_STAGES.indexOf(lead.stage) + dir
    if (idx < 0 || idx >= LEAD_STAGES.length) return
    moveLead(leadId, LEAD_STAGES[idx])
  }

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle="Customers, leads and follow-ups — one record per customer, shared with deals and sales."
        actions={[<JXButton key="new" variant="contained" size="sm" onClick={() => { setFormError(''); setShowNew(true) }}>+ New customer</JXButton>]}
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Customers" value={String(customers.length)} sub={`${salespeople.length} salespeople`} />
        <KpiCard label="Active leads" value={String(activeLeads)} sub={`${leads.filter((l) => l.stage === 'Sold').length} sold · ${leads.filter((l) => l.stage === 'Lost').length} lost`} tone="indigo" />
        <KpiCard label="Overdue follow-ups" value={String(overdueCount)} sub="Follow-up date passed" tone={overdueCount > 0 ? 'rose' : 'emerald'} />
        <KpiCard label="Offers" value={String(offers.length)} sub={`${offers.filter((o) => o.status === 'Open').length} open`} tone="sky" />
      </div>

      {/* Customers */}
        <JXCard title="Customers" description={`${filteredCustomers.length} customer${filteredCustomers.length === 1 ? '' : 's'}`}
          className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
          <div className="mb-3 flex flex-wrap gap-3">
            <div className="min-w-56 flex-1">
              <label htmlFor="crm-customer-search" className="sr-only">Search customers by name, phone, email, or notes</label>
              <JXTextField id="crm-customer-search" className="jx-text-field" label="" aria-label="Search customers by name, phone, email, or notes" value={search} onChange={setSearch} placeholder="Search name, phone, email, notes…" />
            </div>
            <div className="w-full sm:w-52">
            <JXSelect label="Filter by salesperson" className="jx-select-field jx-sr-label" placeholder="All salespeople" value={salesFilter} onChange={setSalesFilter}
                options={[{ id: 'All', label: 'All salespeople' }, ...salespeople.map((s) => ({ id: s, label: s }))]} />
            </div>
          </div>
          {pageItems.length === 0 ? (
            <EmptyState title="No customers match" detail="Adjust the search or salesperson filter, or add a new customer." />
          ) : (
          <>
            <TableScrollHint />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-2">Customer</th><th className="py-2 pr-2">Contact</th><th className="py-2 pr-2">Budget</th><th className="py-2 pr-2">Source</th><th className="py-2 pr-2">Salesperson</th><th className="py-2" />
                </tr></thead>
                <tbody>
                  {pageItems.map((c) => (
                    <tr key={c.id} className={`border-b border-slate-100 dark:border-slate-700 ${selectedCustomerId === c.id && !selectedLead ? 'bg-indigo-50 dark:bg-indigo-950/40' : ''}`}>
                      <td className="py-2 pr-2"><span className="font-semibold text-slate-900 dark:text-white">{c.name}</span><span className="block text-xs text-slate-500 dark:text-slate-400">{c.address}</span></td>
                      <td className="py-2 pr-2">{c.phone}<span className="block text-xs text-slate-500 dark:text-slate-400">{c.email} · prefers {c.preferredContact}</span></td>
                      <td className="py-2 pr-2"><Money value={c.budget} /></td>
                      <td className="py-2 pr-2">{c.leadSource}</td>
                      <td className="py-2 pr-2">{c.salesperson}</td>
                      <td className="py-2 text-right"><JXButton variant="text" size="sm" lockWidth={false} onClick={() => { setSelectedCustomerId(c.id); setSelectedLeadId(null) }}>View</JXButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
          )}
          {controls}
        </JXCard>

        {/* Lead pipeline kanban (plain Tailwind columns — no JXUI kanban component exists for this) */}
        <div className="mt-5">
          <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Lead pipeline</h2>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-3 md:overflow-visible md:pb-0 xl:grid-cols-6">
            {LEAD_STAGES.map((stage) => {
              const stageLeads = leads.filter((l) => l.stage === stage)
              return (
              <div key={stage} className="w-[260px] shrink-0 snap-start rounded-[var(--radius-card)] border border-slate-200 bg-slate-50 p-3 md:w-auto dark:border-slate-700 dark:bg-slate-900/60">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{stage}</span>
                  <JXChip label={String(stageLeads.length)} tone="neutral" />
                </div>
                <div className="space-y-2">
                  {stageLeads.length === 0 && <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">No leads</p>}
                  {stageLeads.map((l) => {
                    const c = customers.find((x) => x.id === l.customerId)
                    const overdue = isOverdue(l.followUpDate, l.stage)
                    return (
                      <div key={l.id}
                        className={`rounded-[var(--radius-control)] border bg-white p-3 shadow-sm dark:bg-[var(--color-surface-dark)] ${selectedLeadId === l.id ? 'border-indigo-500 ring-2 ring-indigo-100 dark:ring-indigo-900' : 'border-slate-200 dark:border-slate-700'}`}>
                        <button type="button" aria-pressed={selectedLeadId === l.id} onClick={() => { setSelectedLeadId(l.id); setSelectedCustomerId(l.customerId) }} className="rounded-sm text-left text-sm font-semibold text-slate-900 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white">{c?.name ?? 'Unknown customer'}</button>
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{l.notes}</p>
                        <p className={`mt-1.5 text-xs ${overdue ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                          Follow-up: {l.followUpDate}{overdue ? ' — OVERDUE' : ''}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Since {l.createdAt} · {c?.salesperson ?? ''}</p>
                        <div className="mt-2 flex items-center justify-between">
                          {/* Plain 44px icon buttons: JXButton locks min-width to 180px,
                              which blows a ~240px kanban column out at every width. */}
                          <button type="button" aria-label="Move lead to previous stage" disabled={LEAD_STAGES.indexOf(l.stage) === 0} onClick={(e) => { e.stopPropagation(); move(l.id, -1) }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-indigo-500/40 text-sm text-indigo-600 hover:bg-slate-50 disabled:opacity-50 dark:border-indigo-400/40 dark:text-indigo-400 dark:hover:bg-slate-800">◀</button>
                          <StatusChip value={l.stage} />
                          <button type="button" aria-label="Move lead to next stage" disabled={LEAD_STAGES.indexOf(l.stage) === LEAD_STAGES.length - 1} onClick={(e) => { e.stopPropagation(); move(l.id, 1) }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-indigo-500/40 text-sm text-indigo-600 hover:bg-slate-50 disabled:opacity-50 dark:border-indigo-400/40 dark:text-indigo-400 dark:hover:bg-slate-800">▶</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Use ◀ ▶ on a lead card to move it between stages. Overdue follow-ups are flagged in red.</p>
      </div>

          {/* Detail panel: selected customer and/or lead */}
          {detailCustomer && (
            <div className="mt-5">
              <JXCard
                title={`${detailCustomer.name} — customer detail`}
                kicker={selectedLead ? `Lead: ${selectedLead.stage}` : 'Customer'}
                description={`${detailCustomer.phone} · ${detailCustomer.email} · ${detailCustomer.address} · Prefers ${detailCustomer.preferredContact} · Budget ${fmtMoney(detailCustomer.budget)} · Source: ${detailCustomer.leadSource} · Salesperson: ${detailCustomer.salesperson}`}
                className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]"
              >
                {detailCustomer.notes && <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">Notes: {detailCustomer.notes}</p>}
                <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
                  Interested in: {detailCustomer.interestedVehicleIds.length === 0 ? '—' : detailCustomer.interestedVehicleIds.map((id) => {
                    const v = vehicles.find((x) => x.id === id)
                    return v ? `${v.stockNumber} (${v.year} ${v.make} ${v.model})` : id
                  }).join(', ')}
                </p>

                {selectedLead && (
                  <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
                    <p className="font-semibold">Lead {selectedLead.id} — {selectedLead.stage}</p>
                    <p className="text-slate-600 dark:text-slate-300">{selectedLead.notes}</p>
                    <p className={isOverdue(selectedLead.followUpDate, selectedLead.stage) ? 'font-semibold text-rose-600' : ''}>
                      Follow-up date: {selectedLead.followUpDate}
                      {isOverdue(selectedLead.followUpDate, selectedLead.stage) ? ' — OVERDUE, follow up now' : selectedLead.followUpDate < today ? ' — past date' : ` — in ${Math.ceil((new Date(selectedLead.followUpDate).getTime() - new Date(today).getTime()) / 86400000)} day(s)`}
                    </p>
                    <p className="text-xs text-slate-500">Created {selectedLead.createdAt}</p>
                  </div>
                )}
                {detailLeads.length > 0 && !selectedLead && (
                  <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">Leads: {detailLeads.map((l) => `${l.stage} (follow-up ${l.followUpDate})`).join(' · ')}</p>
                )}

                <div className="grid gap-5 lg:grid-cols-2">
                  {/* Interactions */}
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Interactions ({detailInteractions.length})</h3>
                    {detailInteractions.length === 0 ? <p className="mb-3 text-sm text-slate-500">No interactions logged yet.</p> : (
                      <ul className="mb-3 space-y-2">
                        {detailInteractions.map((i) => (
                          <li key={i.id} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                            <span className="font-semibold">{i.type}</span> · {i.date} · {i.salesperson}
                            <span className="block text-slate-600 dark:text-slate-300">{i.notes}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                      <div className="space-y-2 rounded-[var(--radius-card)] border border-slate-200 p-3 dark:border-slate-700">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Log interaction</p>
                        <JXSelect label="Type" className="jx-select-field jx-field-select" value={ixType} onChange={(v) => setIxType(v as typeof ixType)} options={(['Call', 'Email', 'WhatsApp', 'Visit', 'Test drive'] as const).map((t) => ({ id: t, label: t }))} />
                        <Field label="Notes"><JXTextField className="jx-text-field" label="" value={ixNotes} onChange={setIxNotes} placeholder="What happened / was agreed…" /></Field>
                        <JXButton variant="contained" size="sm" lockWidth={false} disabled={!ixNotes.trim()} onClick={logInteraction}>Log interaction</JXButton>
                      </div>
                    </div>

                    {/* Offers */}
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Offers ({detailOffers.length})</h3>
                        {
                          detailOffers.length === 0 ? <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">No offers yet.</p> : (
                  <ul className="mb-3 space-y-2">
                    {detailOffers.map((o) => {
                      const v = vehicles.find((x) => x.id === o.vehicleId)
                      return (
                        <li key={o.id} className="rounded-[var(--radius-control)] border border-slate-200 p-3 text-sm dark:border-slate-700">
                          <span className="font-semibold"><Money value={o.amount} /></span> — {v ? `${v.stockNumber} ${v.year} ${v.make} ${v.model}` : o.vehicleId}
                          <span className="ml-2"><StatusChip value={o.status} /></span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">{o.date}{o.notes ? ` · ${o.notes}` : ''}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div className="space-y-2 rounded-[var(--radius-card)] border border-slate-200 p-3 dark:border-slate-700">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">New offer</p>
                  {offerError && <Alert severity="error" title="Check the offer" description={offerError} />}
                  <JXSelect label="Vehicle" className="jx-select-field jx-field-select" searchable placeholder="Select a vehicle" value={offerVehicleId} onChange={setOfferVehicleId}
                    options={vehicles.filter((v) => v.status !== 'Sold').map((v) => ({ id: v.id, label: `${v.stockNumber} — ${v.year} ${v.make} ${v.model} · asking ${fmtMoney(v.askingPrice)}` }))} />
                  <Field label="Amount"><input className={inputCls} type="number" min="0" step="0.01" value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} placeholder="e.g. 19800" /></Field>
                  <JXButton variant="contained" size="sm" lockWidth={false} onClick={submitOffer}>Add offer (Open)</JXButton>
                  <p className="text-xs text-slate-500 dark:text-slate-400">New offers are created with status Open.</p>
                </div>
              </div>
            </div>
            <div className="mt-4"><JXButton variant="text" size="sm" lockWidth={false} onClick={() => { setSelectedCustomerId(null); setSelectedLeadId(null) }}>Close detail</JXButton></div>
          </JXCard>
                  </div>
      )}

                  {showNew && (
                    <Modal title="New customer" onClose={() => setShowNew(false)}>
                      {formError && <div className="mb-3"><Alert severity="error" title="Check the form" description={formError} /></div>}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Name *"><JXTextField className="jx-text-field" label="" value={name} onChange={setName} placeholder="Full name" /></Field>
                        <Field label="Phone"><JXTextField className="jx-text-field" label="" value={phone} onChange={setPhone} placeholder="+971 …" /></Field>
                        <Field label="Email"><JXTextField className="jx-text-field" label="" value={email} onChange={setEmail} placeholder="name@example.com" /></Field>
                        <Field label="Address"><JXTextField className="jx-text-field" label="" value={address} onChange={setAddress} placeholder="Area, city" /></Field>
                        <JXSelect label="Preferred contact" className="jx-select-field jx-field-select" value={pref} onChange={(v) => setPref(v as typeof pref)} options={(['Phone', 'Email', 'WhatsApp'] as const).map((p) => ({ id: p, label: p }))} />
                        <Field label="Budget"><input className={inputCls} type="number" min="0" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 26000" /></Field>
                        <JXSelect label="Lead source" className="jx-select-field jx-field-select" value={leadSource} onChange={setLeadSource} options={['Walk-in', 'Website', 'Referral', 'Online ad', 'Phone'].map((s) => ({ id: s, label: s }))} />
                        <Field label="Salesperson"><JXTextField className="jx-text-field" label="" value={salesperson} onChange={setSalesperson} /></Field>
                        <div className="sm:col-span-2"><Field label="Notes"><JXTextField className="jx-text-field" label="" value={notes} onChange={setNotes} placeholder="What are they looking for?" /></Field></div>
                      </div>
                      <div className="mt-5 flex flex-wrap justify-end gap-2">
                        <JXButton variant="outlined" onClick={() => setShowNew(false)}>Cancel</JXButton>
                        <JXButton variant="contained" onClick={submitCustomer}>Add customer</JXButton>
                      </div>
                    </Modal>
                  )}
                </>
                )
}
