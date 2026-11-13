// Shared store: one React context + reducer over AppState.
// Every module reads/writes the SAME records — no disconnected copies.
// Persistence: localStorage (demo). All money movement goes through
// recordTransaction(), which always writes a journal entry too — a balance
// can never change without a ledger entry.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  Account, AppState, Customer, Deal, DocRecord, Expense, FinancialTransaction,
  JournalEntry, Lead, LeadStage, Part, PartAllocation, Purchase, ReconJob, Role, Settings,
  TeamMember, TransportOrder, Vehicle,
} from './types'
import { money, uid } from './types'
import { buildSeedState } from './seed'
import {
  applyFifoSlices, dealProfit, fifoConsume, vehicleAllInCost,
} from './engine'
import * as serverApi from '../lib/api'
import { API_MODE, getToken } from '../lib/api'

const STORAGE_KEY = 'jx-dealer-tracker-v1'
// API mode is on exactly when VITE_API_URL is set (see src/lib/api.ts).
// Demo mode (unset) keeps the localStorage behaviour below, byte-identical.
const apiMode = API_MODE
const today = () => new Date().toISOString().slice(0, 10)

function loadInitial(): AppState {
  // In API mode the seed is only a placeholder behind the loading screen —
  // real state comes from GET /api/state on mount, never from localStorage.
  if (apiMode) return buildSeedState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (parsed && Array.isArray(parsed.vehicles)) return parsed
    }
  } catch { /* fall through to seed */ }
  return buildSeedState()
}

export interface StoreApi {
  state: AppState
  resetDemo: () => void
  setRole: (role: Role) => void
  updateSettings: (s: Partial<Settings>) => void
  // Vehicles & purchases
  addVehicle: (v: Omit<Vehicle, 'id' | 'createdAt'>) => { ok: boolean; error?: string; id?: string }
  recordPurchase: (p: Omit<Purchase, 'id' | 'ref' | 'createdAt'>, vehicle: Omit<Vehicle, 'id' | 'createdAt'>) => { ok: boolean; error?: string }
  updateVehicleStatus: (vehicleId: string, status: Vehicle['status']) => void
  // Transport
  addTransport: (t: Omit<TransportOrder, 'id'>) => void
  updateTransport: (id: string, patch: Partial<TransportOrder>) => void
  // Expenses / recon
  recordExpense: (e: Omit<Expense, 'id'>) => void
  addReconJob: (j: Omit<ReconJob, 'id'>) => void
  updateReconJob: (id: string, patch: Partial<ReconJob>) => void
  // Parts (FIFO)
  addPart: (part: Omit<Part, 'id'>) => { ok: boolean; error?: string; id?: string }
  allocatePart: (partId: string, vehicleId: string, qty: number) => { ok: boolean; error?: string; cost?: number }
  receivePartBatch: (partId: string, qty: number, unitPrice: number, invoice: string) => void
  // CRM / sales
  addCustomer: (c: Omit<Customer, 'id'>) => string
  moveLead: (leadId: string, stage: LeadStage) => void
  addLead: (l: Omit<Lead, 'id' | 'createdAt'>) => void
  addInteraction: (customerId: string, type: 'Call' | 'Email' | 'WhatsApp' | 'Visit' | 'Test drive', notes: string) => void
  addOffer: (vehicleId: string, customerId: string, amount: number) => void
  createDeal: (d: Omit<Deal, 'id' | 'ref' | 'status' | 'createdAt' | 'finalizedAt' | 'saleRef'>) => string
  finalizeSale: (dealId: string) => { ok: boolean; error?: string; saleRef?: string }
  recordPayment: (receivableId: string, amount: number, accountId: string) => { ok: boolean; error?: string }
  transfer: (fromAccountId: string, toAccountId: string, amount: number, note: string) => { ok: boolean; error?: string }
  addAccount: (account: Omit<Account, 'id'>) => { ok: boolean; error?: string; id?: string }
  // Docs / team
  addDocument: (d: Omit<DocRecord, 'id' | 'uploadedAt' | 'uploadedBy'>) => void
  addTeamMember: (m: Omit<TeamMember, 'id'>) => void
  setMemberActive: (id: string, active: boolean) => void
  markNotificationRead: (id: string) => void
  // Platform / API mode
  apiMode: boolean
  logout: () => void
  lastError: string | null
  clearError: () => void
  reloadFromServer: () => void
}

const StoreCtx = createContext<StoreApi | null>(null)

export function useStore(): StoreApi {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadInitial)
  // API-mode load status. The StoreApi interface is unchanged, so loading /
  // error are rendered by the provider itself instead of being exposed.
  const [apiStatus, setApiStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [apiError, setApiError] = useState('')
  const [lastError, setLastError] = useState<string | null>(null)
  // Client-generated ids returned optimistically by addCustomer, mapped to
  // the server ids once the POST resolves, so a chained createDeal in the
  // same submit can use the real customer id (see the API overrides below).
  const pendingIds = useRef(new Map<string, Promise<string>>())

  const handleLogout = useCallback(() => {
    void serverApi.logout().finally(() => {
      window.location.reload()
    })
  }, [])

  // Full snapshot reload from the server (single source of truth).
  const reloadFromServer = useCallback(() => {
    serverApi.getState()
      .then((s) => setState(s))
      .catch((err) => console.error('Failed to reload state from server:', err))
  }, [])

  const loadFromServer = useCallback(() => {
    setApiStatus('loading')
    setApiError('')
    serverApi.getState()
      .then((s) => { setState(s); setApiStatus('ready') })
      .catch((err) => {
        setApiError(err instanceof Error ? err.message : 'Could not load dealer data.')
        setApiStatus('error')
      })
  }, [])

  useEffect(() => {
    if (!apiMode || !getToken()) return
    loadFromServer()
  }, [loadFromServer])

  useEffect(() => {
    // API mode never writes to localStorage — the server owns the data.
    if (apiMode) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* storage full/blocked */ }
  }, [state])

  const api = useMemo<StoreApi>(() => {
    const audit = (s: AppState, action: string, entityType: string, entityId: string, summary: string): AppState => ({
      ...s,
      audit: [{ id: uid('a'), at: new Date().toISOString(), actor: s.currentUser, action, entityType, entityId, summary }, ...s.audit],
    })

    const postTxn = (s: AppState, txn: FinancialTransaction, journal: JournalEntry): AppState => ({
      ...s,
      transactions: [...s.transactions, txn],
      journal: [...s.journal, journal],
    })

    const nextRef = (prefix: string, list: { ref: string }[]) =>
      `${prefix}-${String(list.length + 1).padStart(4, '0')}`

    // Local (demo) implementation — untouched. Every write below is the
    // original localStorage behaviour; API mode overrides it afterwards.
    const local: StoreApi = {
      state,
      resetDemo: () => setState(buildSeedState()),
      setRole: (role) => setState((s) => ({ ...s, currentRole: role })),
      updateSettings: (patch) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } })),

      addVehicle: (v) => {
        if (state.vehicles.some((x) => x.vin.toUpperCase() === v.vin.toUpperCase())) {
          return { ok: false, error: `A vehicle with VIN ${v.vin} already exists (${state.vehicles.find((x) => x.vin.toUpperCase() === v.vin.toUpperCase())?.stockNumber}).` }
        }
        const id = uid('v')
        setState((s) => audit({ ...s, vehicles: [...s.vehicles, { ...v, id, createdAt: today() }] },
          'VEHICLE_CREATED', 'Vehicle', id, `Vehicle ${v.stockNumber} (${v.year} ${v.make} ${v.model}) registered.`))
        return { ok: true, id }
      },

      recordPurchase: (p, vehicle) => {
        if (state.vehicles.some((x) => x.vin.toUpperCase() === vehicle.vin.toUpperCase())) {
          return { ok: false, error: `A vehicle with VIN ${vehicle.vin} already exists.` }
        }
        const vehicleId = uid('v')
        const purchaseId = uid('p')
        const ref = nextRef('ACQ', state.purchases)
        const total = money(p.vehiclePrice + p.buyerFees + p.auctionFees + p.taxes)
        setState((s) => {
          let next: AppState = {
            ...s,
            vehicles: [...s.vehicles, { ...vehicle, id: vehicleId, createdAt: today() }],
            purchases: [...s.purchases, { ...p, id: purchaseId, ref, createdAt: today(), vehicleId }],
          }
          if (p.paymentStatus !== 'Unpaid') {
            const paid = p.paymentStatus === 'Paid' ? total : money(total / 2)
            const txn: FinancialTransaction = { id: uid('tx'), accountId: 'acc-bank', type: 'Vehicle purchase', amount: -paid, category: 'Purchases', reference: ref, date: today(), note: `Purchase ${vehicle.stockNumber}` }
            const je: JournalEntry = { id: uid('j'), ref: `JE-${String(s.journal.length + 1).padStart(4, '0')}`, date: today(), memo: `Purchase ${vehicle.stockNumber} (${ref})`, lines: [{ account: 'Vehicle Inventory', debit: total, credit: 0 }, { account: 'Operating Bank', debit: 0, credit: paid }, { account: 'Accounts Payable', debit: 0, credit: money(total - paid) }], reversedBy: null, reversed: false }
            next = postTxn(next, txn, je)
            if (p.paymentStatus === 'Partial') {
              next = { ...next, receivables: [...next.receivables, { id: uid('rc'), kind: 'Vendor', entityName: p.seller, reference: ref, total, paid, dueDate: p.purchaseDate, status: 'Partial' }] }
            }
          } else {
            const je: JournalEntry = {
              id: uid('j'),
              ref: `JE-${String(s.journal.length + 1).padStart(4, '0')}`,
              date: today(),
              memo: `Purchase ${vehicle.stockNumber} (${ref})`,
              lines: [
                { account: 'Vehicle Inventory', debit: total, credit: 0 },
                { account: 'Accounts Payable', debit: 0, credit: total },
              ],
              reversedBy: null,
              reversed: false,
            }
            next = {
              ...next,
              journal: [...next.journal, je],
              receivables: [
                ...next.receivables,
                { id: uid('rc'), kind: 'Vendor', entityName: p.seller, reference: ref, total, paid: 0, dueDate: p.purchaseDate, status: 'Open' },
              ],
            }
          }
          return audit(next, 'PURCHASE_RECORDED', 'Purchase', purchaseId,
            `Purchase ${ref} recorded: ${vehicle.year} ${vehicle.make} ${vehicle.model} for ${money(total)}. Vehicle ${vehicle.stockNumber} created.`)
        })
        return { ok: true }
      },

      updateVehicleStatus: (vehicleId, status) =>
        setState((s) => ({ ...s, vehicles: s.vehicles.map((v) => v.id === vehicleId ? { ...v, status } : v) })),

      addTransport: (t) => {
        const id = uid('t')
        setState((s) => audit({ ...s, transport: [...s.transport, { ...t, id }] },
          'TRANSPORT_CREATED', 'TransportOrder', id, `Transport order for ${t.vehicleId} created (${t.carrier}, ${money(t.price)}).`))
      },

      updateTransport: (id, patch) => setState((s) => {
        const order = s.transport.find((t) => t.id === id)
        if (!order) return s
        let next = { ...s, transport: s.transport.map((t) => t.id === id ? { ...t, ...patch } : t) }
        // Delivery closes the loop: vehicle cost basis gains the transport price, status → Received.
        if (patch.status === 'Delivered' && order.status !== 'Delivered') {
          next = {
            ...next,
            vehicles: next.vehicles.map((v) => v.id === order.vehicleId
              ? { ...v, transportCost: money(v.transportCost + order.price), status: v.status === 'In transit' ? 'Received' : v.status }
              : v),
          }
          next = audit(next, 'TRANSPORT_DELIVERED', 'TransportOrder', id,
            `Transport ${id} delivered; ${money(order.price)} added to vehicle cost basis.`)
        }
        return next
      }),

      recordExpense: (e) => {
        const id = uid('e')
        setState((s) => {
          let next: AppState = { ...s, expenses: [...s.expenses, { ...e, id }] }
          if (e.status === 'Paid') {
            const txn: FinancialTransaction = { id: uid('tx'), accountId: 'acc-bank', type: 'Expense payment', amount: -e.amount, category: e.category, reference: e.invoiceRef || id, date: e.date, note: e.description }
            const je: JournalEntry = { id: uid('j'), ref: `JE-${String(s.journal.length + 1).padStart(4, '0')}`, date: e.date, memo: e.description, lines: [{ account: e.category, debit: e.amount, credit: 0 }, { account: 'Operating Bank', debit: 0, credit: e.amount }], reversedBy: null, reversed: false }
            next = postTxn(next, txn, je)
          }
          return audit(next, 'EXPENSE_RECORDED', 'Expense', id, `Expense ${e.description} — ${money(e.amount)} (${e.category}).`)
        })
      },

      addReconJob: (j) => {
        const id = uid('r')
        setState((s) => audit({ ...s, reconJobs: [...s.reconJobs, { ...j, id }] },
          'RECON_JOB_CREATED', 'ReconJob', id, `Recon job "${j.title}" created for ${j.vehicleId} (${j.technician}).`))
      },

      updateReconJob: (id, patch) => setState((s) => ({
        ...s,
        reconJobs: s.reconJobs.map((j) => j.id === id ? { ...j, ...patch } : j),
      })),

      addPart: (part) => {
        const sku = part.sku.trim()
        const name = part.name.trim()
        if (!sku || !name) return { ok: false, error: 'SKU and part name are required.' }
        if (state.parts.some((p) => p.sku.toLowerCase() === sku.toLowerCase())) {
          return { ok: false, error: `A part with SKU ${sku} already exists.` }
        }
        const id = uid('part')
        setState((s) => audit(
          { ...s, parts: [...s.parts, { ...part, id, sku, name }] },
          'PART_CREATED', 'Part', id, `Part ${name} (${sku}) added to catalog.`,
        ))
        return { ok: true, id }
      },

      allocatePart: (partId, vehicleId, qty) => {
        try {
          const { slices, totalCost } = fifoConsume(state.partBatches, partId, qty)
          const alloc: PartAllocation = { id: uid('pa'), partId, vehicleId, qty, fifoCost: totalCost, date: today(), batches: slices }
          setState((s) => {
            const movements = slices.map((sl) => ({
              id: uid('pm'), partId, batchId: sl.batchId, qty: -sl.qty, type: 'consume' as const,
              unitCost: sl.unitPrice, totalCost: -money(sl.qty * sl.unitPrice), vehicleId, date: today(),
              note: `FIFO: ${sl.qty} @ $${sl.unitPrice} to ${vehicleId}`,
            }))
            const next: AppState = {
              ...s,
              partBatches: applyFifoSlices(s.partBatches, slices),
              partMovements: [...s.partMovements, ...movements],
              partAllocations: [...s.partAllocations, alloc],
            }
            return audit(next, 'PART_ALLOCATED', 'PartAllocation', alloc.id,
              `${qty} units of ${partId} allocated to ${vehicleId} at FIFO cost ${money(totalCost)}.`)
          })
          return { ok: true, cost: totalCost }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Allocation failed' }
        }
      },

      receivePartBatch: (partId, qty, unitPrice, invoice) => {
        const batchId = uid('b')
        setState((s) => ({
          ...s,
          partBatches: [...s.partBatches, { id: batchId, partId, qtyReceived: qty, qtyRemaining: qty, unitPrice, invoice, purchaseDate: today() }],
          partMovements: [...s.partMovements, { id: uid('pm'), partId, batchId, qty, type: 'purchase', unitCost: unitPrice, totalCost: money(qty * unitPrice), vehicleId: null, date: today(), note: `Batch received (${invoice})` }],
        }))
      },

      addCustomer: (c) => {
        const id = uid('c')
        setState((s) => ({ ...s, customers: [...s.customers, { ...c, id }] }))
        return id
      },

      moveLead: (leadId, stage) => setState((s) => ({
        ...s,
        leads: s.leads.map((l) => l.id === leadId ? { ...l, stage } : l),
      })),

      addLead: (l) => setState((s) => ({ ...s, leads: [...s.leads, { ...l, id: uid('l'), createdAt: today() }] })),

      addInteraction: (customerId, type, notes) => setState((s) => ({
        ...s,
        interactions: [{ id: uid('i'), customerId, type, date: today(), notes, salesperson: s.currentUser }, ...s.interactions],
      })),

      addOffer: (vehicleId, customerId, amount) => setState((s) => ({
        ...s,
        offers: [{ id: uid('o'), vehicleId, customerId, amount, date: today(), status: 'Open', notes: '' }, ...s.offers],
      })),

      createDeal: (d) => {
        const id = uid('d')
        const ref = nextRef('DEAL', state.deals)
        setState((s) => ({ ...s, deals: [...s.deals, { ...d, id, ref, status: 'Draft', createdAt: today(), finalizedAt: null, saleRef: null }] }))
        return id
      },

      finalizeSale: (dealId) => {
        const deal = state.deals.find((d) => d.id === dealId)
        if (!deal) return { ok: false, error: 'Deal not found.' }
        if (deal.status === 'Finalized') return { ok: false, error: 'Deal is already finalized.' }
        const vehicle = state.vehicles.find((v) => v.id === deal.vehicleId)
        if (!vehicle) return { ok: false, error: 'Vehicle not found.' }
        if (vehicle.status === 'Sold') return { ok: false, error: `Vehicle ${vehicle.stockNumber} is already sold.` }
        if (!['Available', 'Reserved'].includes(vehicle.status)) {
          return { ok: false, error: `Vehicle ${vehicle.stockNumber} is ${vehicle.status} — only Available or Reserved vehicles can be sold.` }
        }
        const customer = state.customers.find((c) => c.id === deal.customerId)
        if (!customer) return { ok: false, error: 'Customer not found.' }
        const totalCost = vehicleAllInCost(vehicle, state.expenses, state.partAllocations, state.settings.overheadPerVehicle)
        const profit = dealProfit(deal, totalCost)
        const saleRef = nextRef('SALE', state.sales)
        // One single setState = one atomic transition: no partial finalisation.
        setState((s) => {
          const saleId = uid('s')
          const txn: FinancialTransaction = { id: uid('tx'), accountId: 'acc-bank', type: 'Vehicle sale', amount: money(deal.sellingPrice - deal.discount), category: 'Sales', reference: saleRef, date: today(), note: `${vehicle.year} ${vehicle.make} ${vehicle.model} sold to ${customer.name}` }
          const je: JournalEntry = { id: uid('j'), ref: `JE-${String(s.journal.length + 1).padStart(4, '0')}`, date: today(), memo: `Sale ${saleRef}: ${vehicle.year} ${vehicle.make} ${vehicle.model}`, lines: [{ account: 'Operating Bank', debit: money(deal.sellingPrice - deal.discount), credit: 0 }, { account: 'Sales Revenue', debit: 0, credit: money(deal.sellingPrice - deal.discount) }, { account: 'Cost of Goods Sold', debit: totalCost, credit: 0 }, { account: 'Vehicle Inventory', debit: 0, credit: totalCost }], reversedBy: null, reversed: false }
          let next: AppState = {
            ...s,
            vehicles: s.vehicles.map((v) => v.id === vehicle.id ? { ...v, status: 'Sold' as const } : v),
            deals: s.deals.map((d) => d.id === dealId ? { ...d, status: 'Finalized' as const, finalizedAt: today(), saleRef } : d),
            sales: [...s.sales, { id: saleId, ref: saleRef, dealId, vehicleId: vehicle.id, customerId: customer.id, sellingPrice: money(deal.sellingPrice - deal.discount), totalCost, grossProfit: profit.grossProfit, netProfit: profit.netProfit, marginPct: profit.marginPct, date: today() }],
            leads: s.leads.map((l) => l.customerId === customer.id ? { ...l, stage: 'Sold' as const } : l),
            transactions: [...s.transactions, txn],
            journal: [...s.journal, je],
          }
          const outstanding = money(deal.sellingPrice - deal.discount - deal.deposit)
          if (outstanding > 0) {
            next = { ...next, receivables: [...next.receivables, { id: uid('rc'), kind: 'Customer', entityName: customer.name, reference: saleRef, total: money(deal.sellingPrice - deal.discount), paid: deal.deposit, dueDate: today(), status: 'Partial' }] }
          }
          return audit(next, 'SALE_FINALIZED', 'Sale', saleId,
            `Sale ${saleRef} finalized: ${vehicle.year} ${vehicle.make} ${vehicle.model} sold for ${money(deal.sellingPrice - deal.discount)}, net profit ${money(profit.netProfit)}.`)
        })
        return { ok: true, saleRef }
      },

      recordPayment: (receivableId, amount, accountId) => {
        const rec = state.receivables.find((r) => r.id === receivableId)
        if (!rec) return { ok: false, error: 'Balance not found.' }
        if (amount <= 0) return { ok: false, error: 'Amount must be positive.' }
        if (amount > money(rec.total - rec.paid)) return { ok: false, error: `Amount exceeds the outstanding balance of ${money(rec.total - rec.paid)}.` }
        const isCustomer = rec.kind === 'Customer'
        setState((s) => {
          const acctName = s.accounts.find((a) => a.id === accountId)?.name ?? 'Operating Bank'
          const txn: FinancialTransaction = {
            id: uid('tx'),
            accountId,
            type: isCustomer ? 'Customer payment' : 'Vendor payment',
            amount: isCustomer ? amount : -amount,
            category: 'Receivables',
            reference: rec.reference,
            date: today(),
            note: `${isCustomer ? 'Payment from' : 'Payment to'} ${rec.entityName}`,
          }
          const je: JournalEntry = {
            id: uid('j'),
            ref: `JE-${String(s.journal.length + 1).padStart(4, '0')}`,
            date: today(),
            memo: `Payment ${rec.reference}`,
            lines: isCustomer
              ? [
                  { account: acctName, debit: amount, credit: 0 },
                  { account: 'Accounts Receivable', debit: 0, credit: amount },
                ]
              : [
                  { account: 'Accounts Payable', debit: amount, credit: 0 },
                  { account: acctName, debit: 0, credit: amount },
                ],
            reversedBy: null,
            reversed: false,
          }
          const next: AppState = {
            ...s,
            receivables: s.receivables.map((r) => r.id === receivableId ? { ...r, paid: money(r.paid + amount), status: money(r.paid + amount) >= r.total ? 'Paid' as const : 'Partial' as const } : r),
            transactions: [...s.transactions, txn],
            journal: [...s.journal, je],
          }
          return audit(next, 'PAYMENT_RECORDED', 'Receivable', receivableId, `Payment of ${money(amount)} ${isCustomer ? 'received for' : 'paid on'} ${rec.reference}.`)
        })
        return { ok: true }
      },

      transfer: (fromAccountId, toAccountId, amount, note) => {
        if (fromAccountId === toAccountId) return { ok: false, error: 'Source and destination accounts must differ.' }
        if (amount <= 0) return { ok: false, error: 'Amount must be positive.' }
        setState((s) => {
          const je: JournalEntry = { id: uid('j'), ref: `JE-${String(s.journal.length + 1).padStart(4, '0')}`, date: today(), memo: `Transfer: ${note}`, lines: [{ account: toAccountId, debit: amount, credit: 0 }, { account: fromAccountId, debit: 0, credit: amount }], reversedBy: null, reversed: false }
          return {
            ...s,
            transactions: [
              ...s.transactions,
              { id: uid('tx'), accountId: fromAccountId, type: 'Transfer', amount: -amount, category: 'Transfers', reference: je.ref, date: today(), note },
              { id: uid('tx'), accountId: toAccountId, type: 'Transfer', amount, category: 'Transfers', reference: je.ref, date: today(), note },
            ],
            journal: [...s.journal, je],
          }
        })
        return { ok: true }
      },

      addAccount: (account) => {
        const name = account.name.trim()
        if (!name) return { ok: false, error: 'Account name is required.' }
        const id = uid('acc')
        setState((s) => audit(
          { ...s, accounts: [...s.accounts, { ...account, id, name }] },
          'ACCOUNT_CREATED', 'Account', id, `Account "${name}" (${account.type}) created.`,
        ))
        return { ok: true, id }
      },

      addDocument: (d) => setState((s) => ({
        ...s,
        documents: [{ ...d, id: uid('doc'), uploadedAt: today(), uploadedBy: s.currentUser }, ...s.documents],
      })),

      addTeamMember: (m) => setState((s) => ({ ...s, team: [...s.team, { ...m, id: uid('tm') }] })),
      setMemberActive: (id, active) => setState((s) => ({ ...s, team: s.team.map((m) => m.id === id ? { ...m, active } : m) })),
      markNotificationRead: (id) => setState((s) => ({ ...s, notifications: s.notifications.map((n) => n.id === id ? { ...n, read: true } : n) })),
      apiMode,
      logout: handleLogout,
      lastError,
      clearError: () => setLastError(null),
      reloadFromServer,
    }

    if (!apiMode) return local

    // ---- API mode ---------------------------------------------------------
    // The StoreApi interface is synchronous — pages read the result of a
    // write immediately (e.g. `const res = addVehicle(v); if (!res.ok) …`).
    // A network call cannot answer synchronously, so API-mode writes run
    // the SAME guards as the local version against the server-loaded state
    // (that is what catches a duplicate VIN — the server's 409 — before the
    // call is made), return the same {ok, error} / id shape optimistically,
    // then call the API and reload the whole state with GET /api/state, so
    // the server snapshot is the single source of truth after every
    // mutation. If the server rejects a call the guards could not foresee,
    // the error is logged and the reload restores server truth; the page
    // already moved on, which is the known trade-off of the sync interface.
    // A future change that lets pages await these calls can return the
    // server's own result (and its real ids) instead.
    const fire = (p: Promise<unknown>) => {
      setLastError(null)
      p.then(() => reloadFromServer()).catch((err: unknown) => {
        console.error('API mutation failed:', err)
        setLastError(err instanceof Error ? err.message : 'Server request failed')
        reloadFromServer()
      })
    }

    return {
      ...local,
      // Role comes from the server (GET /api/state) — the in-app role
      // switcher is a demo control and must not override it in API mode.
      setRole: () => {},
      resetDemo: () => { reloadFromServer() },
      updateSettings: (patch) => { fire(serverApi.updateSettings(patch)) },

      addVehicle: (v) => {
        if (state.vehicles.some((x) => x.vin.toUpperCase() === v.vin.toUpperCase())) {
          return { ok: false, error: `A vehicle with VIN ${v.vin} already exists (${state.vehicles.find((x) => x.vin.toUpperCase() === v.vin.toUpperCase())?.stockNumber}).` }
        }
        fire(serverApi.addVehicle(v))
        // No id yet — the server assigns it. The caller stays on the list
        // and the vehicle appears after the reload; returning a
        // client-made id would navigate to a detail page that 404s.
        return { ok: true }
      },

      recordPurchase: (p, vehicle) => {
        if (state.vehicles.some((x) => x.vin.toUpperCase() === vehicle.vin.toUpperCase())) {
          return { ok: false, error: `A vehicle with VIN ${vehicle.vin} already exists.` }
        }
        fire(serverApi.recordPurchase(p, vehicle))
        return { ok: true }
      },

      updateVehicleStatus: (vehicleId, status) => { fire(serverApi.updateVehicleStatus(vehicleId, status)) },

      addTransport: (t) => { fire(serverApi.addTransport(t)) },
      updateTransport: (id, patch) => { fire(serverApi.updateTransport(id, patch)) },

      recordExpense: (e) => { fire(serverApi.recordExpense(e)) },

      addReconJob: (j) => { fire(serverApi.addReconJob(j)) },
      updateReconJob: (id, patch) => { fire(serverApi.updateReconJob(id, patch)) },

      addPart: (part) => {
        const sku = part.sku.trim()
        const name = part.name.trim()
        if (!sku || !name) return { ok: false, error: 'SKU and part name are required.' }
        if (state.parts.some((p) => p.sku.toLowerCase() === sku.toLowerCase())) {
          return { ok: false, error: `A part with SKU ${sku} already exists.` }
        }
        fire(serverApi.addPart({ ...part, sku, name }))
        return { ok: true }
      },

      allocatePart: (partId, vehicleId, qty) => {
        try {
          const { totalCost } = fifoConsume(state.partBatches, partId, qty)
          fire(serverApi.allocatePart(partId, vehicleId, qty))
          return { ok: true, cost: totalCost }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'Allocation failed' }
        }
      },

      receivePartBatch: (partId, qty, unitPrice, invoice) => {
        fire(serverApi.receivePartBatch(partId, qty, unitPrice, invoice))
      },

      addCustomer: (c) => {
        const clientId = uid('c')
        const done = serverApi.addCustomer(c)
        pendingIds.current.set(clientId, done.then((created) => created.id))
        fire(done)
        return clientId
      },

      moveLead: (leadId, stage) => { fire(serverApi.moveLead(leadId, stage)) },
      addLead: (l) => { fire(serverApi.addLead(l)) },

      addInteraction: (customerId, type, notes) => { fire(serverApi.addInteraction(customerId, type, notes)) },
      addOffer: (vehicleId, customerId, amount) => { fire(serverApi.addOffer(vehicleId, customerId, amount)) },

      createDeal: (d) => {
        const clientId = uid('d')
        const pendingCustomer = pendingIds.current.get(d.customerId)
        const done = pendingCustomer
          ? pendingCustomer.then((realId) => serverApi.createDeal({ ...d, customerId: realId }))
          : serverApi.createDeal(d)
        fire(done)
        return clientId
      },

      finalizeSale: (dealId) => {
        const deal = state.deals.find((d) => d.id === dealId)
        if (!deal) return { ok: false, error: 'Deal not found.' }
        if (deal.status === 'Finalized') return { ok: false, error: 'Deal is already finalized.' }
        const vehicle = state.vehicles.find((v) => v.id === deal.vehicleId)
        if (!vehicle) return { ok: false, error: 'Vehicle not found.' }
        if (vehicle.status === 'Sold') return { ok: false, error: `Vehicle ${vehicle.stockNumber} is already sold.` }
        if (!['Available', 'Reserved'].includes(vehicle.status)) {
          return { ok: false, error: `Vehicle ${vehicle.stockNumber} is ${vehicle.status} — only Available or Reserved vehicles can be sold.` }
        }
        const customer = state.customers.find((c) => c.id === deal.customerId)
        if (!customer) return { ok: false, error: 'Customer not found.' }
        fire(serverApi.finalizeSale(dealId))
        return { ok: true, saleRef: nextRef('SALE', state.sales) }
      },

      recordPayment: (receivableId, amount, accountId) => {
        const rec = state.receivables.find((r) => r.id === receivableId)
        if (!rec) return { ok: false, error: 'Balance not found.' }
        if (amount <= 0) return { ok: false, error: 'Amount must be positive.' }
        if (amount > money(rec.total - rec.paid)) return { ok: false, error: `Amount exceeds the outstanding balance of ${money(rec.total - rec.paid)}.` }
        fire(serverApi.recordPayment(receivableId, amount, accountId))
        return { ok: true }
      },

      transfer: (fromAccountId, toAccountId, amount, note) => {
        if (fromAccountId === toAccountId) return { ok: false, error: 'Source and destination accounts must differ.' }
        if (amount <= 0) return { ok: false, error: 'Amount must be positive.' }
        fire(serverApi.transfer(fromAccountId, toAccountId, amount, note))
        return { ok: true }
      },

      addAccount: (account) => {
        const name = account.name.trim()
        if (!name) return { ok: false, error: 'Account name is required.' }
        fire(serverApi.addAccount({ ...account, name }))
        return { ok: true }
      },

      addDocument: (d) => { fire(serverApi.addDocument(d)) },

      addTeamMember: (m) => { fire(serverApi.addTeamMember(m)) },
      setMemberActive: (id, active) => { fire(serverApi.setMemberActive(id, active)) },
      markNotificationRead: (id) => { fire(serverApi.markNotificationRead(id)) },
    }
  }, [state, reloadFromServer, lastError, handleLogout])

  if (apiMode && getToken() && apiStatus === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
          <p className="mt-3 text-sm font-semibold text-slate-700">Loading your dealership…</p>
          <p className="mt-1 text-xs text-slate-400">Fetching the latest data from the server.</p>
        </div>
      </div>
    )
  }

  if (apiMode && getToken() && apiStatus === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">Could not load dealer data</h1>
          <p className="mt-2 text-sm text-slate-500">{apiError}</p>
          <p className="mt-1 text-sm text-slate-500">Check that the API server is running and reachable, then try again.</p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={loadFromServer}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => { serverApi.clearTokens(); window.location.reload() }}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>
}
