import ResponsiveTable from '../components/ResponsiveTable'
import { useMemo, useState } from 'react'

import { AppTextField as JXTextField } from "../components/AppTextField"
import { useStore } from '../store/store'
import { ROLES, type Role } from '../store/types'
import { Alert, EmptyState, Field, Modal, PageHeader, StatusChip, TableScrollHint, usePagination } from '../components/ui'

import {JXAvatar, JXAvatarGroup, JXButton, JXSelect, JXSwitch, JXTimeline} from '../components/JXUI'
// Read-only permission matrix — what each role is allowed to do in the app's design.
// Enforced in the UI only (buttons hidden/disabled); there is no server to enforce it yet.
const MATRIX: { capability: string; perms: Record<Role, boolean> }[] = [
  { capability: 'View dashboard, inventory & reports', perms: { Owner: true, Admin: true, Manager: true, Sales: true, Accountant: true, Technician: true, Viewer: true } },
  { capability: 'Add / edit vehicles & purchases', perms: { Owner: true, Admin: true, Manager: true, Sales: false, Accountant: false, Technician: false, Viewer: false } },
  { capability: 'Create deals & finalise sales', perms: { Owner: true, Admin: true, Manager: true, Sales: true, Accountant: false, Technician: false, Viewer: false } },
  { capability: 'Record payments & transfers (Finance)', perms: { Owner: true, Admin: true, Manager: false, Sales: false, Accountant: true, Technician: false, Viewer: false } },
  { capability: 'Record expenses', perms: { Owner: true, Admin: true, Manager: true, Sales: false, Accountant: true, Technician: false, Viewer: false } },
  { capability: 'Reconditioning & parts allocation', perms: { Owner: true, Admin: true, Manager: true, Sales: false, Accountant: false, Technician: true, Viewer: false } },
  { capability: 'Manage team & roles', perms: { Owner: true, Admin: true, Manager: false, Sales: false, Accountant: false, Technician: false, Viewer: false } },
  { capability: 'Change settings & reset demo data', perms: { Owner: true, Admin: true, Manager: false, Sales: false, Accountant: false, Technician: false, Viewer: false } },
]

const CAN_MANAGE_TEAM = ['Owner', 'Admin'] as const

export default function Team() {
  const { state, addTeamMember, setMemberActive } = useStore()
  const canManage = (CAN_MANAGE_TEAM as readonly string[]).includes(state.currentRole)
  const [showInvite, setShowInvite] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('Sales')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const { pageItems, controls } = usePagination(state.team, 10)
  const auditSorted = useMemo(() => [...state.audit].sort((a, b) => b.at.localeCompare(a.at)), [state.audit])
  const { pageItems: auditPage, controls: auditControls } = usePagination(auditSorted, 10)

  const submitInvite = () => {
    setError(''); setDone('')
    if (!name.trim()) { setError('Name is required.'); return }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid email address.'); return }
    if (state.team.some((m) => m.email.toLowerCase() === email.trim().toLowerCase())) { setError('A team member with that email already exists.'); return }
    addTeamMember({ name: name.trim(), email: email.trim(), role, active: true })
    setDone(`${name.trim()} invited as ${role}. In this demo build the invite is a local team record — no email is sent and there is no real authentication.`)
    setName(''); setEmail('')
  }

  const thCls = 'border-b border-slate-200 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400'
  const tdCls = 'border-b border-slate-100 px-4 py-2.5 text-slate-700 dark:border-slate-700 dark:text-slate-300'

  return (
    <>
      <PageHeader title="Team & Permissions" subtitle="Who works here, what each role can do, and everything the tracker has recorded."
        actions={<JXButton variant="contained" size="sm" disabled={!canManage} onClick={() => { setShowInvite(true); setError(''); setDone('') }}>Invite member</JXButton>} />
      {!canManage && (
        <div className="mb-5">
          <Alert severity="info" title="Read-only for your role"
            description={`You are signed in as ${state.currentRole}. Inviting members and changing active status are available to Owner and Admin only. This is UI-level gating; server-side enforcement needs the production backend.`} />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Team ({state.team.length})</h2>
        {state.team.length > 0 && (
          <JXAvatarGroup
            size="sm"
            max={6}
            items={state.team.map((member) => ({
              name: member.name,
              role: member.role,
              status: member.active ? 'online' : 'offline',
            }))}
          />
        )}
      </div>
      {state.team.length === 0
        ? <EmptyState title="No team members" />
        : (
          <>
              <TableScrollHint />
              <div className="mb-4 overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                <ResponsiveTable><table className="w-full min-w-[640px] text-sm">
                  <thead><tr><th className={thCls}>Member</th><th className={thCls}>Email</th><th className={thCls}>Role</th><th className={thCls}>Status</th><th className={thCls}>Active</th></tr></thead>
                  <tbody>
                    {pageItems.map((m) => (
                      <tr key={m.id}>
                        <td className={tdCls}>
                          <span className="flex items-center gap-2">
                            <JXAvatar name={m.name} role={m.role} size="sm" status={m.active ? 'online' : 'offline'} />
                            <span className="font-medium text-slate-900 dark:text-white">{m.name}</span>
                          </span>
                        </td>
                        <td className={tdCls}>{m.email}</td>
                        <td className={tdCls}><StatusChip value={m.role} /></td>
                        <td className={tdCls}><StatusChip value={m.active ? 'Active' : 'Closed'} /></td>
                        <td className={tdCls}>
                          <JXSwitch checked={m.active} disabled={!canManage} label={m.active ? 'Active' : 'Inactive'}
                            onChange={(checked) => setMemberActive(m.id, checked)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></ResponsiveTable>
              </div>
              {controls}
            </>
        )}

            <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900 dark:text-white">Role permission matrix</h2>
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
              Read-only reference. Roles are enforced at UI level in this build (buttons hidden or disabled); a production backend must enforce them server-side.
            </p>
              <TableScrollHint />
              <div className="mb-4 overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                <ResponsiveTable><table className="w-full min-w-[640px] text-sm">
                  <thead><tr><th className={thCls}>Capability</th>{ROLES.map((r) => <th key={r} className={`${thCls} text-center`}>{r}</th>)}</tr></thead>
                  <tbody>
                    {MATRIX.map((row) => (
                      <tr key={row.capability}>
                        <td className={tdCls}>{row.capability}</td>
                        {ROLES.map((r) => (
                            <td key={r} className={`${tdCls} text-center ${row.perms[r] ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                              {row.perms[r] ? '✓' : '—'}
                            </td>
                ))}
                          </tr>
                        ))}
                      </tbody>
        </table></ResponsiveTable>
              </div>

              <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900 dark:text-white">Audit trail</h2>
              <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Newest first. Every store action that matters (sales, purchases, payments, parts, expenses) writes an entry here.</p>
              {auditSorted.length === 0
                ? <EmptyState title="No audit events yet" />
                : (
                  <>
                    <JXTimeline events={auditPage.map((a, index) => ({
                      id: a.id,
                      title: a.summary,
                      timestamp: new Date(a.at).toLocaleString(),
                      status: index === 0 ? 'active' : 'neutral',
                      payload: `${a.action} · ${a.entityType} ${a.entityId} · ${a.actor}`,
                    }))} />
            { auditControls }
          </>
        )}

                    {showInvite && (
                      <Modal title="Invite member" onClose={() => setShowInvite(false)}>
                        <div className="space-y-4">
                          <Field label="Full name">
                            <JXTextField className="jx-text-field" label="" value={name} onChange={setName} placeholder="e.g. Dana Karim" />
                          </Field>
                          <Field label="Email">
                            <JXTextField className="jx-text-field" label="" value={email} onChange={setEmail} placeholder="name@jxautosales.demo" />
                          </Field>
                          <JXSelect label="Role" className="jx-select-field jx-field-select" options={ROLES.map((r) => ({ id: r, label: r }))} value={role} onChange={(v) => setRole(v as Role)} />
                          <p className="text-xs text-slate-500 dark:text-slate-400">Demo build: the invite creates a local team record only. No email is sent, no account is created, and there is no real authentication behind it.</p>
                          {error && <Alert severity="error" title="Cannot invite member" description={error} />}
                          {done && <Alert severity="success" title={done} />}
                          <div className="flex flex-wrap justify-end gap-2">
                            <JXButton variant="outlined" onClick={() => setShowInvite(false)}>Close</JXButton>
                            <JXButton variant="contained" onClick={submitInvite}>Invite member</JXButton>
                          </div>
                        </div>
                      </Modal>
                    )}
                  </>
                )
              }
