import ResponsiveTable from '../components/ResponsiveTable'
import { useMemo, useState } from 'react'
import {JXButton, JXCard, JXSelect} from '../components/JXUI'

import { AppTextField as JXTextField } from "../components/AppTextField"
import { useStore } from '../store/store'
import { accountBalance, totalCash } from '../store/engine'
import { fmtMoney, type Account } from '../store/types'
import {
  Alert, EmptyState, ExportButton, Field, KpiCard, Modal, Money,
  PageHeader, StatusChip, TableScrollHint, usePagination,
} from '../components/ui'

const FINANCE_ROLES = ['Owner', 'Admin', 'Accountant'] as const
const today = () => new Date().toISOString().slice(0, 10)

export default function Finance() {
  const { state, recordPayment, transfer, addAccount } = useStore()
  const canFinance = (FINANCE_ROLES as readonly string[]).includes(state.currentRole)

  const [acctFilter, setAcctFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [showPayment, setShowPayment] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showNewAccount, setShowNewAccount] = useState(false)

  // Record payment form
  const activeAccounts = state.accounts.filter((a) => a.status === 'Active')
  const openReceivables = state.receivables.filter((r) => r.total - r.paid > 0)
  const [payRecId, setPayRecId] = useState(openReceivables[0]?.id ?? '')
  const [payAmount, setPayAmount] = useState('')
  const [payAccount, setPayAccount] = useState(activeAccounts[0]?.id ?? '')
  const [payError, setPayError] = useState('')
  const [payDone, setPayDone] = useState('')

  // Transfer form
  const [fromAcct, setFromAcct] = useState(activeAccounts[0]?.id ?? '')
  const [toAcct, setToAcct] = useState(activeAccounts[1]?.id ?? activeAccounts[0]?.id ?? '')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferNote, setTransferNote] = useState('')
  const [transferError, setTransferError] = useState('')
  const [transferDone, setTransferDone] = useState('')

  // New account form
  const [acctName, setAcctName] = useState('')
  const [acctType, setAcctType] = useState<Account['type']>('Bank')
  const [acctOpening, setAcctOpening] = useState('0')
  const [acctError, setAcctError] = useState('')
  const [acctDone, setAcctDone] = useState('')

  const cash = totalCash(state)
  const receivablesOut = useMemo(
    () => state.receivables.filter((r) => r.kind === 'Customer').reduce((s, r) => s + (r.total - r.paid), 0),
    [state.receivables],
  )
  const payablesOut = useMemo(
    () => state.receivables.filter((r) => r.kind !== 'Customer').reduce((s, r) => s + (r.total - r.paid), 0),
    [state.receivables],
  )

  const txnTypes = useMemo(
    () => [...new Set(state.transactions.map((t) => t.type))],
    [state.transactions],
  )
  const filteredTxns = useMemo(
    () => [...state.transactions]
      .filter((t) => (acctFilter === 'all' || t.accountId === acctFilter) && (typeFilter === 'all' || t.type === typeFilter))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [state.transactions, acctFilter, typeFilter],
  )
  const { pageItems: txnPage, controls: txnControls } = usePagination(filteredTxns, 10)

  const submitPayment = () => {
    setPayError(''); setPayDone('')
    const amount = Number(payAmount)
    if (!payRecId) { setPayError('Select a receivable first.'); return }
    const res = recordPayment(payRecId, amount, payAccount)
    if (!res.ok) { setPayError(res.error ?? 'Payment failed.'); return }
    setPayDone(`Payment of ${fmtMoney(amount)} recorded.`)
    setPayAmount('')
  }

  const submitTransfer = () => {
    setTransferError(''); setTransferDone('')
    const amount = Number(transferAmount)
    const res = transfer(fromAcct, toAcct, amount, transferNote.trim() || 'Account transfer')
    if (!res.ok) { setTransferError(res.error ?? 'Transfer failed.'); return }
    setTransferDone(`Transferred ${fmtMoney(amount)} — balances and journal updated.`)
    setTransferAmount(''); setTransferNote('')
  }

  const submitAccount = () => {
    setAcctError(''); setAcctDone('')
    const openingBalance = Number(acctOpening)
    if (!acctName.trim()) { setAcctError('Account name is required.'); return }
    if (!Number.isFinite(openingBalance) || openingBalance < 0) { setAcctError('Opening balance must be 0 or more.'); return }
    const res = addAccount({
      name: acctName.trim(),
      type: acctType,
      currency: state.settings.currency || 'USD',
      openingBalance,
      status: 'Active',
    })
    if (!res.ok) { setAcctError(res.error ?? 'Could not create account.'); return }
    setAcctDone(`Account "${acctName.trim()}" created.`)
    setAcctName(''); setAcctOpening('0')
  }

  const isOverdue = (dueDate: string, outstanding: number) => outstanding > 0 && dueDate < today()

  const balanceRows = (r: (typeof state.receivables)[number]) => {
    const outstanding = r.total - r.paid
    return { outstanding, overdue: isOverdue(r.dueDate, outstanding) }
  }

  const tableCls = 'w-full min-w-[640px] text-sm'
  const thCls = 'border-b border-slate-200 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400'
  const tdCls = 'border-b border-slate-100 px-4 py-2.5 text-slate-700 dark:border-slate-700 dark:text-slate-300'

  return (
    <>
      <PageHeader
        title="Finance"
        subtitle="Accounts, transactions, receivables & payables and the double-entry journal — every balance change goes through the store, never edited by hand."
        actions={
          <>
            <JXButton variant="contained" size="sm" disabled={!canFinance} onClick={() => {
              setPayRecId(openReceivables[0]?.id ?? '')
              setPayAccount(activeAccounts[0]?.id ?? '')
              setShowPayment(true); setPayError(''); setPayDone('')
            }}>
              Record payment
            </JXButton>
            <JXButton variant="outlined" size="sm" disabled={!canFinance} onClick={() => {
              setFromAcct(activeAccounts[0]?.id ?? '')
              setToAcct(activeAccounts[1]?.id ?? activeAccounts[0]?.id ?? '')
              setShowTransfer(true); setTransferError(''); setTransferDone('')
            }}>
              Transfer
            </JXButton>
            <JXButton variant="outlined" size="sm" disabled={!canFinance} onClick={() => {
              setShowNewAccount(true); setAcctError(''); setAcctDone('')
            }}>
              + New account
            </JXButton>
          </>
        }
      />
      {!canFinance && (
        <div className="mb-5">
          <Alert severity="info" title="Read-only for your role"
            description={`You are signed in as ${state.currentRole}. Finance write actions (record payment, transfer) are available to Owner, Admin and Accountant only. This is UI-level gating; server-side enforcement needs the production backend.`} />
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Total cash (all accounts)" value={fmtMoney(cash)} sub="Sum of computed account balances" tone="indigo" />
        <KpiCard label="Receivables outstanding" value={fmtMoney(receivablesOut)} sub="Customer balances still owed" tone="amber" />
        <KpiCard label="Payables outstanding" value={fmtMoney(payablesOut)} sub="Vendor & carrier balances still owed" tone="rose" />
      </div>

      <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Accounts</h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {state.accounts.map((a) => (
          <JXCard key={a.id} title={a.name} kicker={a.type} description={`Opening balance ${fmtMoney(a.openingBalance)} · ${a.currency}`}
            className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 dark:text-white"><Money value={accountBalance(state, a.id)} /></p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Computed live: opening balance + signed transactions. No stored balance field.</p>
            <div className="mt-2"><StatusChip value={a.status} /></div>
          </JXCard>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Receivables (customers)</h2>
          {state.receivables.filter((r) => r.kind === 'Customer').length === 0
            ? <EmptyState title="No receivables" detail="No customer balances are outstanding." />
            : (
              <>
                <TableScrollHint />
                <div className="overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                  <ResponsiveTable><table className={tableCls}>
                    <thead><tr><th className={thCls}>Customer</th><th className={thCls}>Ref</th><th className={thCls}>Total</th><th className={thCls}>Paid</th><th className={thCls}>Outstanding</th><th className={thCls}>Due</th><th className={thCls}>Status</th></tr></thead>
                    <tbody>
                      {state.receivables.filter((r) => r.kind === 'Customer').map((r) => {
                        const { outstanding, overdue } = balanceRows(r)
                        return (
                          <tr key={r.id}>
                            <td className={tdCls}>{r.entityName}</td>
                            <td className={tdCls}>{r.reference}</td>
                            <td className={tdCls}><Money value={r.total} /></td>
                            <td className={tdCls}><Money value={r.paid} /></td>
                            <td className={tdCls}><Money value={outstanding} /></td>
                            <td className={tdCls}>{r.dueDate}{overdue && <span className="ml-2 font-semibold text-rose-600 dark:text-rose-400">Overdue</span>}</td>
                            <td className={tdCls}><StatusChip value={overdue ? 'Overdue' : r.status} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table></ResponsiveTable>
                </div>
              </>
            )}
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Payables (vendors & carriers)</h2>
          {state.receivables.filter((r) => r.kind !== 'Customer').length === 0
            ? <EmptyState title="No payables" detail="No vendor or carrier balances are outstanding." />
            : (
              <>
                <TableScrollHint />
                <div className="overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                  <ResponsiveTable><table className={tableCls}>
                    <thead><tr><th className={thCls}>Payee</th><th className={thCls}>Ref</th><th className={thCls}>Total</th><th className={thCls}>Paid</th><th className={thCls}>Outstanding</th><th className={thCls}>Due</th><th className={thCls}>Status</th></tr></thead>
                    <tbody>
                      {state.receivables.filter((r) => r.kind !== 'Customer').map((r) => {
                        const { outstanding, overdue } = balanceRows(r)
                        return (
                          <tr key={r.id}>
                            <td className={tdCls}>{r.entityName} <span className="text-xs text-slate-500 dark:text-slate-400">({r.kind})</span></td>
                            <td className={tdCls}>{r.reference}</td>
                            <td className={tdCls}><Money value={r.total} /></td>
                            <td className={tdCls}><Money value={r.paid} /></td>
                            <td className={tdCls}><Money value={outstanding} /></td>
                            <td className={tdCls}>{r.dueDate}{overdue && <span className="ml-2 font-semibold text-rose-600 dark:text-rose-400">Overdue</span>}</td>
                            <td className={tdCls}><StatusChip value={overdue ? 'Overdue' : r.status} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table></ResponsiveTable>
                </div>
              </>
            )}
        </section>
      </div>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Transactions</h2>
        <div className="flex flex-wrap gap-2">
          <div className="w-full sm:w-44">
            <JXSelect label="Filter by account" className="jx-select-field jx-sr-label" placeholder="All accounts" options={[{ id: 'all', label: 'All accounts' }, ...state.accounts.map((a) => ({ id: a.id, label: a.name }))]} value={acctFilter} onChange={setAcctFilter} />
          </div>
          <div className="w-full sm:w-48">
            <JXSelect label="Filter by transaction type" className="jx-select-field jx-sr-label" placeholder="All types" options={[{ id: 'all', label: 'All types' }, ...txnTypes.map((t) => ({ id: t, label: t }))]} value={typeFilter} onChange={setTypeFilter} />
          </div>
          <ExportButton filename="finance-transactions.csv" rows={filteredTxns.map((t) => ({
            date: t.date, account: state.accounts.find((a) => a.id === t.accountId)?.name ?? t.accountId,
            type: t.type, amount: t.amount, category: t.category, reference: t.reference, note: t.note,
          }))} />
        </div>
      </div>
      {filteredTxns.length === 0
        ? <EmptyState title="No transactions" detail="Nothing matches the selected account / type filters." />
        : (
          <>
              <TableScrollHint />
              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-slate-200 bg-white dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                <ResponsiveTable><table className={tableCls}>
                  <thead><tr><th className={thCls}>Date</th><th className={thCls}>Account</th><th className={thCls}>Type</th><th className={thCls}>Category</th><th className={thCls}>Reference</th><th className={thCls}>Note</th><th className={`${thCls} text-right`}>Amount</th></tr></thead>
                  <tbody>
                    {txnPage.map((t) => (
                      <tr key={t.id}>
                        <td className={tdCls}>{t.date}</td>
                        <td className={tdCls}>{state.accounts.find((a) => a.id === t.accountId)?.name ?? t.accountId}</td>
                        <td className={tdCls}>{t.type}</td>
                        <td className={tdCls}>{t.category}</td>
                        <td className={tdCls}>{t.reference}</td>
                        <td className={tdCls}>{t.note}</td>
                        <td className={`${tdCls} text-right font-mono ${t.amount < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}><Money value={t.amount} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table></ResponsiveTable>
              </div>
              {txnControls}
            </>
        )}

            <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900 dark:text-white">Double-entry journal</h2>
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
              Every money movement in the store writes a journal entry alongside its transaction — a balance can never change without a ledger entry.
            </p>
            {state.journal.length === 0
              ? <EmptyState title="No journal entries" />
              : (
          <>
            <TableScrollHint />
            <div className="space-y-3">
              {[...state.journal].reverse().map((j) => (
                <JXCard key={j.id} title={`${j.ref} · ${j.date}`} kicker={j.memo}
                  className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                  {j.reversed && <p className="mb-2 text-sm font-semibold text-rose-600 dark:text-rose-400">Reversed{j.reversedBy ? ` by ${j.reversedBy}` : ''}</p>}
                  <div className="overflow-x-auto">
                    <ResponsiveTable><table className={tableCls}>
                      <thead><tr><th className={thCls}>Account</th><th className={`${thCls} text-right`}>Debit</th><th className={`${thCls} text-right`}>Credit</th></tr></thead>
                      <tbody>
                        {j.lines.map((l, i) => (
                          <tr key={i}>
                            <td className={tdCls}>{l.account}</td>
                            <td className={`${tdCls} text-right font-mono`}>{l.debit ? fmtMoney(l.debit) : '—'}</td>
                            <td className={`${tdCls} text-right font-mono`}>{l.credit ? fmtMoney(l.credit) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table></ResponsiveTable>
                  </div>
                </JXCard>
              ))}
            </div>
          </>
              )}

            {showPayment && (
              <Modal title="Record payment" onClose={() => setShowPayment(false)}>
                <div className="space-y-4">
                  <JXSelect label="Receivable (outstanding balance)" className="jx-select-field jx-field-select" placeholder="Select a receivable" options={openReceivables.map((r) => ({ id: r.id, label: `${r.entityName} — ${r.reference} — outstanding ${fmtMoney(r.total - r.paid)}` }))}
                    value={payRecId} onChange={setPayRecId} />
                  <Field label="Amount (USD)">
                    <JXTextField className="jx-text-field" label="" value={payAmount} onChange={setPayAmount} placeholder="e.g. 5000" />
                  </Field>
                  <JXSelect label="Into account" className="jx-select-field jx-field-select" options={state.accounts.filter((a) => a.status === 'Active').map((a) => ({ id: a.id, label: `${a.name} (${fmtMoney(accountBalance(state, a.id))})` }))}
                    value={payAccount} onChange={setPayAccount} />
                  {payError && <Alert severity="error" title="Payment not recorded" description={payError} />}
                  {payDone && <Alert severity="success" title={payDone} />}
                  <p className="text-xs text-slate-500 dark:text-slate-400">Paying more than the outstanding balance is rejected by the store — try it and you will see the overpayment error.</p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <JXButton variant="outlined" onClick={() => setShowPayment(false)}>Cancel</JXButton>
                    <JXButton variant="contained" onClick={submitPayment}>Record payment</JXButton>
                  </div>
                </div>
              </Modal>
            )}

            {showTransfer && (
              <Modal title="Transfer between accounts" onClose={() => setShowTransfer(false)}>
                <div className="space-y-4">
                  <JXSelect label="From account" className="jx-select-field jx-field-select" options={state.accounts.filter((a) => a.status === 'Active').map((a) => ({ id: a.id, label: `${a.name} (${fmtMoney(accountBalance(state, a.id))})` }))}
                    value={fromAcct} onChange={setFromAcct} />
                  <JXSelect label="To account" className="jx-select-field jx-field-select" options={state.accounts.filter((a) => a.status === 'Active').map((a) => ({ id: a.id, label: `${a.name} (${fmtMoney(accountBalance(state, a.id))})` }))}
                    value={toAcct} onChange={setToAcct} />
                  <Field label="Amount (USD)">
                    <JXTextField className="jx-text-field" label="" value={transferAmount} onChange={setTransferAmount} placeholder="e.g. 1000" />
                  </Field>
                  <Field label="Note">
                    <JXTextField className="jx-text-field" label="" value={transferNote} onChange={setTransferNote} placeholder="Reason for the transfer" />
                  </Field>
                  {transferError && <Alert severity="error" title="Transfer failed" description={transferError} />}
                  {transferDone && <Alert severity="success" title={transferDone} />}
                  <div className="flex flex-wrap justify-end gap-2">
                    <JXButton variant="outlined" onClick={() => setShowTransfer(false)}>Cancel</JXButton>
                    <JXButton variant="contained" onClick={submitTransfer}>Transfer</JXButton>
                  </div>
                </div>
              </Modal>
            )}

            {showNewAccount && (
              <Modal title="New financial account" onClose={() => setShowNewAccount(false)}>
                <div className="space-y-4">
                  <Field label="Account name">
                    <JXTextField className="jx-text-field" label="" value={acctName} onChange={setAcctName} placeholder="e.g. Operating Bank" />
                  </Field>
                  <JXSelect
                    label="Account type"
                    className="jx-select-field jx-field-select"
                    options={(['Bank', 'Cash', 'Petty cash', 'Floorplan', 'Credit'] as const).map((t) => ({ id: t, label: t }))}
                    value={acctType}
                    onChange={(v) => setAcctType(v as Account['type'])}
                  />
                  <Field label="Opening balance (USD)">
                    <JXTextField className="jx-text-field" label="" value={acctOpening} onChange={setAcctOpening} placeholder="0" />
                  </Field>
                  {acctError && <Alert severity="error" title="Could not create account" description={acctError} />}
                  {acctDone && <Alert severity="success" title={acctDone} />}
                  <div className="flex flex-wrap justify-end gap-2">
                    <JXButton variant="outlined" onClick={() => setShowNewAccount(false)}>Close</JXButton>
                    <JXButton variant="contained" onClick={submitAccount}>Create account</JXButton>
                  </div>
                </div>
              </Modal>
            )}
          </>
        )
      }
