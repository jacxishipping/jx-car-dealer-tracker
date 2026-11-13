// AI Voice-to-Work assistant — deterministic text-command parser.
//
// There is NO AI backend in this build: commands are matched by a small
// deterministic parser (regex + keyword rules) against the live store.
// Every command follows the same workflow:
//   parse → proposed operation → Before / After preview → explicit Confirm
//   → execute via useStore() → audit entry → result shown.
// Nothing executes on parse. Purchases, sales, payments, refunds and
// deletions are NEVER executed from a text command in this build: they
// always stop at a confirm screen and must be completed in their module.
import { useMemo, useState } from 'react'
import { CheckCircle2, ImagePlus, Mic, RotateCcw, Send, ShieldAlert, Sparkles } from 'lucide-react'
import { JXAlert, JXButton, JXCard, JXChip } from '@jacxishippingorg/jx-ui-react'
import { AppTextField as JXTextField } from "../components/AppTextField"
import { useStore } from '../store/store'
import * as serverApi from '../lib/api'
import { daysInStock, vehicleAllInCost } from '../store/engine'
import { fmtMoney, type ExpenseCategory, type Vehicle } from '../store/types'
import { Alert, Field, inputCls, PageHeader, StatusChip } from '../components/ui'

const today = () => new Date().toISOString().slice(0, 10)

type Parsed =
  | { kind: 'create_vehicle'; year: number; make: string; model: string; price: number }
  | { kind: 'record_transport'; stockNumber: string; amount: number }
  | { kind: 'record_expense'; amount: number; category: ExpenseCategory; vehicleRef: string }
  | { kind: 'query_aged'; days: number }
  | { kind: 'query_losing' }
  | { kind: 'query_followups' }
  | { kind: 'sensitive'; action: string; detail: string }
  | { kind: 'unknown' }

const CATEGORY_WORDS: [RegExp, ExpenseCategory][] = [
  [/detail/i, 'Detailing'],
  [/mechanic|repair/i, 'Mechanical repairs'],
  [/body/i, 'Bodywork'],
  [/paint/i, 'Paint'],
  [/tire|tyre/i, 'Tires'],
  [/battery/i, 'Battery'],
  [/glass|windshield|windscreen/i, 'Glass'],
  [/inspect/i, 'Inspection'],
  [/part/i, 'Parts'],
  [/labo[u]?r/i, 'Labor'],
  [/transport/i, 'Transportation'],
  [/auction/i, 'Auction fees'],
  [/advertis|listing/i, 'Advertising'],
  [/rent/i, 'Rent'],
  [/utilit/i, 'Utilities'],
  [/insur/i, 'Insurance'],
  [/payroll|salary|wage/i, 'Payroll'],
]

function parseCommand(raw: string): Parsed {
  const cmd = raw.trim()
  const lower = cmd.toLowerCase()

  // Sensitive operations first: they are never executed from a command.
  const sensitive = lower.match(/\b(sell|sale|purchase|buy|pay|payment|refund|delete|remove)\b/)
  if (sensitive) {
    return { kind: 'sensitive', action: sensitive[1], detail: cmd }
  }

  // "Add a 2022 Honda Accord for $16,500"
  const add = cmd.match(/add\s+(?:a\s+|an\s+|the\s+)?(\d{4})\s+([A-Za-z]+)\s+([A-Za-z0-9][A-Za-z0-9 ]*?)\s+for\s+\$?([\d,]+(?:\.\d{2})?)/i)
  if (add) {
    return {
      kind: 'create_vehicle',
      year: Number(add[1]),
      make: add[2].replace(/^\w/, (c) => c.toUpperCase()),
      model: add[3].trim(),
      price: Number(add[4].replace(/,/g, '')),
    }
  }

  // "Record $350 transportation for stock number CDT-101"
  const transport = cmd.match(/record\s+\$?([\d,]+(?:\.\d{2})?)\s+transport(?:ation)?\s+(?:for|to)\s+(?:stock\s+number\s+)?([A-Za-z0-9-]+)/i)
  if (transport) {
    return { kind: 'record_transport', amount: Number(transport[1].replace(/,/g, '')), stockNumber: transport[2].toUpperCase() }
  }

  // "Add $280 detailing expense to the Honda"
  const expense = cmd.match(/(?:add|record)\s+\$?([\d,]+(?:\.\d{2})?)\s+([A-Za-z ]+?)\s+expense\s+(?:to|for)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9 ]*)/i)
  if (expense) {
    const category = CATEGORY_WORDS.find(([re]) => re.test(expense[2]))?.[1] ?? 'Other overhead'
    return { kind: 'record_expense', amount: Number(expense[1].replace(/,/g, '')), category, vehicleRef: expense[3].trim() }
  }

  const aged = lower.match(/(?:held|older|over|more than)\D*?(\d+)\s*days/) ?? lower.match(/aged\D*?(\d+)/)
  if (/held|aged|older than/.test(lower) && aged) return { kind: 'query_aged', days: Number(aged[1]) }
  if (/losing money|underwater|loss-making|negative profit/.test(lower)) return { kind: 'query_losing' }
  if (/follow[- ]?up/.test(lower)) return { kind: 'query_followups' }
  return { kind: 'unknown' }
}

const EXAMPLES = [
  'Add a 2022 Honda Accord for $16,500',
  'Record $350 transportation for stock number CDT-101',
  'Add $280 detailing expense to the Honda',
  'Show all vehicles held for more than 45 days',
  'Which vehicles are losing money?',
  'Show customers who need follow-up',
]

function resolveVehicle(vehicles: Vehicle[], ref: string): Vehicle | undefined {
  const r = ref.trim().toLowerCase()
  return (
    vehicles.find((v) => v.stockNumber.toLowerCase() === r) ??
    vehicles.find((v) => v.vin.toLowerCase() === r) ??
    vehicles.find((v) => v.make.toLowerCase() === r && v.status !== 'Sold') ??
    vehicles.find((v) => v.make.toLowerCase() === r) ??
    vehicles.find((v) => `${v.make} ${v.model}`.toLowerCase().includes(r)) ??
    vehicles.find((v) => v.model.toLowerCase() === r)
  )
}

export default function AiAssistant() {
  const { state, addVehicle, recordExpense, apiMode, reloadFromServer } = useStore()
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [opId, setOpId] = useState<string | null>(null)
  const [raw, setRaw] = useState('')
  const [voiceNote, setVoiceNote] = useState('')
  const [photoNote, setPhotoNote] = useState('')
  const [photoName, setPhotoName] = useState('')
  const [vin, setVin] = useState('')
  const [stockNumber, setStockNumber] = useState('')
  const [askingPrice, setAskingPrice] = useState('')
  const [result, setResult] = useState('')
  const [history, setHistory] = useState<{ cmd: string; outcome: string }[]>([])

  const nextStock = useMemo(() => {
    const nums = state.vehicles.map((v) => Number(v.stockNumber.replace(/\D/g, ''))).filter((n) => n > 0)
    return `CDT-${Math.max(100, ...nums) + 1}`
  }, [state.vehicles])

  const runParse = (text: string) => {
    setRaw(text)
    setResult('')
    setVoiceNote('')
    setOpId(null)
    const p = parseCommand(text)
    setParsed(p)
    if (p.kind === 'create_vehicle') {
      setStockNumber(nextStock)
      setVin('')
      setAskingPrice(String(p.price))
    }
    if (apiMode) {
      serverApi.proposeAiOperation(text)
        .then((res) => setOpId(res.operation.id))
        .catch((err) => console.error('AI operation log failed:', err))
    }
  }

  const allIn = (v: Vehicle) =>
    vehicleAllInCost(v, state.expenses, state.partAllocations, state.settings.overheadPerVehicle)

  const finish = (outcome: string) => {
    setResult(outcome)
    setHistory((h) => [{ cmd: raw, outcome }, ...h].slice(0, 10))
    setParsed(null)
  }

  const confirm = () => {
    if (!parsed) return
    if (parsed.kind === 'create_vehicle') {
      if (vin.trim().length < 11) {
        setResult('A VIN is required before confirming — enter the vehicle VIN (11–17 characters). The assistant never invents a VIN.')
        return
      }
      if (apiMode && opId) {
        const cleanVin = vin.trim().toUpperCase()
        if (state.vehicles.some((x) => x.vin.toUpperCase() === cleanVin)) {
          setResult(`A vehicle with VIN ${cleanVin} already exists.`)
          return
        }
        serverApi.confirmAiOperation(opId, {
          confirm: true,
          vin: cleanVin,
          stockNumber: stockNumber.trim() || nextStock,
          askingPrice: Number(askingPrice) || parsed.price,
        })
          .then((res) => {
            reloadFromServer()
            setOpId(null)
            finish(res.operation.summary || `Vehicle created: ${stockNumber.trim() || nextStock} — ${parsed.year} ${parsed.make} ${parsed.model} for ${fmtMoney(parsed.price)}. An audit entry was written.`)
          })
          .catch((err: unknown) => {
            setResult(err instanceof Error ? err.message : 'Could not confirm AI operation.')
          })
        return
      }
      const res = addVehicle({
        stockNumber: stockNumber.trim() || nextStock,
        vin: vin.trim().toUpperCase(),
        year: parsed.year, make: parsed.make, model: parsed.model, trim: '',
        extColor: '', intColor: '', mileage: 0, transmission: 'Automatic', engine: '',
        fuel: 'Petrol', drivetrain: 'FWD', bodyType: 'Sedan', condition: 'Good',
        titleStatus: 'Clean', status: 'Purchased', purchaseDate: today(),
        purchaseSource: 'Other dealer', purchasePrice: parsed.price, auctionFees: 0,
        transportCost: 0, askingPrice: Number(askingPrice) || parsed.price,
        minPrice: parsed.price, photos: [], notes: 'Added via AI Assistant (deterministic parser).',
      })
      if (!res.ok) { setResult(res.error ?? 'Could not add the vehicle.'); return }
      finish(`Vehicle created: ${stockNumber.trim() || nextStock} — ${parsed.year} ${parsed.make} ${parsed.model} for ${fmtMoney(parsed.price)}. An audit entry was written.`)
      return
    }
    if (parsed.kind === 'record_transport' || parsed.kind === 'record_expense') {
      const isTransport = parsed.kind === 'record_transport'
      const ref = isTransport ? parsed.stockNumber : parsed.vehicleRef
      const vehicle = resolveVehicle(state.vehicles, ref)
      if (!vehicle) { setResult(`Could not find a vehicle matching "${ref}". Check the stock number or make and try again — nothing was recorded.`); return }
      const category: ExpenseCategory = isTransport ? 'Transportation' : parsed.category
      if (apiMode && opId) {
        serverApi.confirmAiOperation(opId, { confirm: true })
          .then((res) => {
            reloadFromServer()
            setOpId(null)
            finish(res.operation.summary || `${category} expense of ${fmtMoney(parsed.amount)} recorded for ${vehicle.stockNumber} (${vehicle.year} ${vehicle.make} ${vehicle.model}).`)
          })
          .catch((err: unknown) => {
            setResult(err instanceof Error ? err.message : 'Could not confirm AI operation.')
          })
        return
      }
      const description = isTransport
        ? `Transport — ${vehicle.stockNumber}`
        : `${category} — ${vehicle.stockNumber}`
      recordExpense({
        description, amount: parsed.amount, category, date: today(), vendor: '',
        vehicleId: vehicle.id, kind: 'Direct', paymentMethod: 'Bank transfer',
        status: 'Pending', invoiceRef: '', createdBy: state.currentUser,
        notes: 'Recorded via AI Assistant (deterministic parser).',
      })
      finish(`${category} expense of ${fmtMoney(parsed.amount)} recorded for ${vehicle.stockNumber} (${vehicle.year} ${vehicle.make} ${vehicle.model}). All-in cost is now ${fmtMoney(allIn(vehicle) + parsed.amount)}. An audit entry was written.`)
      return
    }
    if (parsed.kind === 'sensitive') {
      if (apiMode && opId) {
        void serverApi.confirmAiOperation(opId, { confirm: true }).catch(() => { })
        setOpId(null)
      }
      // Deliberately NOT executed: the confirm screen is the end of the road
      // for money-moving and destructive operations in this build.
      finish(`Not executed. "${parsed.action}" is a sensitive operation — sales, purchases, payments, refunds and deletions are never executed from a text command. Complete it in the Sales, Purchases or Finance module.`)
    }
  }

  // Query results are computed live from the store at render time.
  const aged = parsed?.kind === 'query_aged'
    ? state.vehicles.filter((v) => v.status !== 'Sold' && daysInStock(v) > parsed.days)
    : []
  const losing = parsed?.kind === 'query_losing'
    ? state.vehicles.filter((v) => v.status !== 'Sold' && v.askingPrice < allIn(v))
    : []
  const followups = parsed?.kind === 'query_followups'
    ? state.leads
      .filter((l) => l.stage !== 'Sold' && l.stage !== 'Lost' && l.followUpDate < today())
      .map((l) => ({ lead: l, customer: state.customers.find((c) => c.id === l.customerId) }))
    : []

  const expenseVehicle = parsed?.kind === 'record_expense' ? resolveVehicle(state.vehicles, parsed.vehicleRef) : undefined
  const transportVehicle = parsed?.kind === 'record_transport'
    ? state.vehicles.find((v) => v.stockNumber.toUpperCase() === parsed.stockNumber)
    : undefined
  const targetVehicle = expenseVehicle ?? transportVehicle

  return (
    <>
      <PageHeader
        title="AI Assistant"
        subtitle="Voice-to-Work — type a command in plain English. Deterministic parser, no AI backend in this build: nothing executes until you confirm it."
      />
      <JXAlert
        severity="info"
        title="How this works"
        description="The parser recognises add-vehicle, record-transport, record-expense and three query commands (aged stock, losing money, follow-ups). Every write shows a Before / After preview and waits for your Confirm. Sales, purchases, payments, refunds and deletions always stop at a confirm screen and are never executed from a command."
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
            <JXCard className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
              <div className="p-5">
                  <div className="flex flex-wrap gap-2">
                    <JXTextField
                      id="ai-command-input"
                      className="jx-text-field min-w-0 flex-1"
                      label=""
                      value={input}
                      onChange={setInput}
                      onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) runParse(input) }}
                      placeholder='Try: "Add a 2022 Honda Accord for $16,500"'
                      aria-label="Command"
                    />
                      <JXButton variant="contained" lockWidth={false} onClick={() => input.trim() && runParse(input)}>
                        <span className="inline-flex items-center gap-1.5"><Send className="h-4 w-4" /> Run</span>
                      </JXButton>
                      <JXButton
                        variant="outlined"
                        lockWidth={false}
                        title="Voice input"
                        onClick={() => setVoiceNote('Voice input is not connected in this build — type your command.')}
                      >
                        <span className="inline-flex items-center gap-1.5"><Mic className="h-4 w-4" /> Voice</span>
                      </JXButton>
                  </div>
                  {voiceNote && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{voiceNote}</p>}

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Example commands — tap to fill in</p>
                    <div className="flex flex-wrap gap-2">
                      {EXAMPLES.map((ex) => (
                          <button type="button" key={ex} onClick={() => { setInput(ex); runParse(ex) }}
                            className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:border-indigo-400 hover:text-indigo-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:text-indigo-300">
                            {ex}
                          </button>
                  ))}
                        </div>
              </div>

                      <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Receipt / invoice photo (optional)</span>
                        <label htmlFor="ai-photo-upload" className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-700 hover:border-indigo-600 dark:border-slate-600 dark:text-slate-200">
                          <ImagePlus className="h-4 w-4" />
                          <span>{photoName ? photoName : 'Choose a photo…'}</span>
                          <input
                            id="ai-photo-upload"
                            type="file"
                            accept="image/*"
                            aria-label="Receipt or invoice photo (optional)"
                            className="sr-only"
                            onChange={(e) => {
                              const f = e.target.files?.[0]
                              if (f) { setPhotoName(f.name); setPhotoNote(`Recorded file name only ("${f.name}") — no OCR in this build. The file itself is not uploaded or stored.`) }
                            }}
                          />
                        </label>
                        {photoNote && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{photoNote}</p>}
                      </div>
                    </div>
                  </JXCard>

                  {/* Proposed operation / confirm screen */}
                  {parsed && parsed.kind !== 'unknown' && parsed.kind !== 'query_aged' && parsed.kind !== 'query_losing' && parsed.kind !== 'query_followups' && (
                      <JXCard className="mt-5 !rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                        <div className="p-5">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Proposed operation — confirm before anything happens</h2>
                          </div>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Parsed from: “{raw}” — nothing has been executed yet.</p>

                          {parsed.kind === 'sensitive' && (
                            <div className="mt-4">
                              <Alert severity="warning" title="Sensitive operation — confirm required"
                                description={`"${parsed.action}" moves money or destroys data, so the assistant never executes it from a text command. Confirming here only acknowledges the request; complete the ${parsed.action} in the Sales, Purchases or Finance module.`} />
                              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Requested: {parsed.detail}</p>
                            </div>
                          )}

                          {parsed.kind === 'create_vehicle' && (
                            <div className="mt-4 space-y-3">
                              <p className="text-sm text-slate-700 dark:text-slate-200">
                                Create vehicle: <strong>{parsed.year} {parsed.make} {parsed.model}</strong> — purchase price {fmtMoney(parsed.price)}.
                              </p>
                              <div className="grid gap-3 sm:grid-cols-3">
                                <Field label="Stock number"><input className={inputCls} value={stockNumber} onChange={(e) => setStockNumber(e.target.value)} /></Field>
                                <Field label="VIN (required)"><input className={inputCls} value={vin} onChange={(e) => setVin(e.target.value)} placeholder="17-character VIN" /></Field>
                                <Field label="Asking price ($)"><input className={inputCls} type="number" value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} /></Field>
                              </div>
                              <div className="grid gap-3 text-sm sm:grid-cols-2">
                                <div className="rounded-[var(--radius-control)] bg-slate-50 p-3 dark:bg-slate-900"><p className="font-semibold">Before</p><p className="text-slate-500 dark:text-slate-400">{state.vehicles.length} vehicles in the tracker.</p></div>
                                <div className="rounded-[var(--radius-control)] bg-indigo-50 p-3 dark:bg-indigo-950"><p className="font-semibold">After</p><p className="text-slate-600 dark:text-slate-300">{state.vehicles.length + 1} vehicles — new {stockNumber || nextStock} ({parsed.year} {parsed.make} {parsed.model}), status Purchased.</p></div>
                              </div>
                            </div>
                          )}

                          {(parsed.kind === 'record_transport' || parsed.kind === 'record_expense') && targetVehicle && (
                            <div className="mt-4 space-y-3">
                              <p className="text-sm text-slate-700 dark:text-slate-200">
                                Record <strong>{fmtMoney(parsed.amount)}</strong> {parsed.kind === 'record_transport' ? 'transportation' : parsed.category} expense for{' '}
                                <strong>{targetVehicle.stockNumber} — {targetVehicle.year} {targetVehicle.make} {targetVehicle.model}</strong> (Direct, Pending).
                              </p>
                              <div className="grid gap-3 text-sm sm:grid-cols-2">
                                <div className="rounded-[var(--radius-control)] bg-slate-50 p-3 dark:bg-slate-900"><p className="font-semibold">Before</p><p className="text-slate-500 dark:text-slate-400">All-in cost {fmtMoney(allIn(targetVehicle))} · {state.expenses.length} expenses recorded.</p></div>
                                <div className="rounded-[var(--radius-control)] bg-indigo-50 p-3 dark:bg-indigo-950"><p className="font-semibold">After</p><p className="text-slate-600 dark:text-slate-300">All-in cost {fmtMoney(allIn(targetVehicle) + parsed.amount)} · {state.expenses.length + 1} expenses recorded.</p></div>
                              </div>
                            </div>
                          )}
                          {(parsed.kind === 'record_transport' || parsed.kind === 'record_expense') && !targetVehicle && (
                              <p className="mt-4 text-sm text-rose-600 dark:text-rose-400">
                                No vehicle matches “{parsed.kind === 'record_transport' ? parsed.stockNumber : parsed.vehicleRef}”. Nothing will be recorded — check the stock number or make and try again.
                              </p>
                )}

                                  <div className="mt-5 flex flex-wrap gap-2">
                                    <JXButton variant="contained" color="success" lockWidth={false} onClick={confirm}>
                                      <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />
                                        {parsed.kind === 'sensitive' ? 'Confirm — review only, do not execute' : 'Confirm & execute'}</span>
                                    </JXButton>
                                      <JXButton variant="outlined" lockWidth={false} onClick={() => {
                                        if (apiMode && opId) {
                                          void serverApi.confirmAiOperation(opId, { confirm: false }).catch(() => { })
                                          setOpId(null)
                                        }
                                        setParsed(null)
                                        setResult('Cancelled — nothing was executed.')
                                      }}>Cancel</JXButton>
                </div>
                                  <p className="mt-2 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><ShieldAlert className="h-3.5 w-3.5" /> Executing writes an audit entry under your name ({state.currentUser}).</p>
                              </div>
                            </JXCard>
                          )}

                          {parsed?.kind === 'unknown' && (
                            <div className="mt-5"><Alert severity="warning" title="Could not understand that command"
                              description={`"${raw}" did not match any known pattern. Try one of the example commands — the parser handles add-vehicle, record-transport, record-expense, aged stock, losing-money and follow-up queries.`} /></div>
                          )}

                          {/* Query results */}
                          {parsed?.kind === 'query_aged' && (
                              <JXCard className="mt-5 !rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                                <div className="p-5">
                                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">Vehicles held for more than {parsed.days} days ({aged.length})</h2>
                                      {aged.length === 0 ? <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">None — no unsold vehicle has been held longer than {parsed.days} days.</p> : (
                                        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
                                          {aged.map((v) => (
                                            <li key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                                              <span className="font-semibold">{v.stockNumber}</span>
                                              <span>{v.year} {v.make} {v.model}</span>
                                              <StatusChip value={v.status} />
                                              <span className="ml-auto text-slate-500 dark:text-slate-400">{daysInStock(v)} days · asking {fmtMoney(v.askingPrice)}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
            </JXCard>
          )}
                              {parsed?.kind === 'query_losing' && (
                                  <JXCard className="mt-5 !rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                                    <div className="p-5">
                                      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Vehicles losing money — asking price below all-in cost ({losing.length})</h2>
                                          {losing.length === 0 ? <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">None — every unsold vehicle is priced above its all-in cost.</p> : (
                                            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
                                              {losing.map((v) => (
                                                <li key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                                                  <span className="font-semibold">{v.stockNumber}</span>
                                                  <span>{v.year} {v.make} {v.model}</span>
                                                  <span className="ml-auto text-slate-500 dark:text-slate-400">asking {fmtMoney(v.askingPrice)} · all-in {fmtMoney(allIn(v))} · shortfall {fmtMoney(allIn(v) - v.askingPrice)}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </div>
            </JXCard>
          )}
                                  {parsed?.kind === 'query_followups' && (
            <JXCard className="mt-5 !rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
              <div className="p-5">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Customers who need follow-up — follow-up date in the past ({followups.length})</h2>
                {followups.length === 0 ? <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">None — no open lead has an overdue follow-up date.</p> : (
                  <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
                    {followups.map(({ lead, customer }) => (
                      <li key={lead.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                        <span className="font-semibold">{customer?.name ?? 'Unknown customer'}</span>
                        <JXChip label={lead.stage} tone="amber" />
                        <span className="ml-auto text-slate-500 dark:text-slate-400">follow-up was due {lead.followUpDate} · {customer?.preferredContact} {customer?.phone}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </JXCard>
          )}

          {result && (
            <div className="mt-5">
              <JXAlert severity="success" title="Result" description={result} />
              {state.audit[0] && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Latest audit entry: {state.audit[0].at.slice(0, 19).replace('T', ' ')} — {state.audit[0].summary}</p>}
            </div>
          )}
        </div>

        <div>
          <JXCard className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
            <div className="p-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">What the parser understands</h2>
              <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <li><strong>Add vehicle:</strong> “Add a 2022 Honda Accord for $16,500”</li>
                <li><strong>Transport:</strong> “Record $350 transportation for stock number CDT-101”</li>
                <li><strong>Expense:</strong> “Add $280 detailing expense to the Honda”</li>
                <li><strong>Aged stock:</strong> “Show all vehicles held for more than 45 days”</li>
                <li><strong>Losing money:</strong> “Which vehicles are losing money?”</li>
                <li><strong>Follow-ups:</strong> “Show customers who need follow-up”</li>
              </ul>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Queries read live store data (days in stock, all-in cost, lead follow-up dates). Amounts use fmtMoney; a vehicle is “losing money” when asking price &lt; all-in cost.</p>
              <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Session history</h3>
                  {history.length > 0 && (
                    <button type="button" onClick={() => setHistory([])} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300"><RotateCcw className="h-3.5 w-3.5" /> Clear</button>
                  )}
                </div>
                {history.length === 0
                  ? <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No commands run yet. Click an example prompt above or type a command to preview.</p>
                  : <ul className="mt-2 space-y-2 text-sm">{history.map((h, i) => (
                    <li key={i} className="rounded-[var(--radius-control)] bg-slate-50 p-2 dark:bg-slate-900"><p className="font-medium text-slate-700 dark:text-slate-200">“{h.cmd}”</p><p className="text-slate-500 dark:text-slate-400">{h.outcome}</p></li>
                  ))}</ul>}
              </div>
            </div>
          </JXCard>
        </div>
      </div>
    </>
                          )
                          }
