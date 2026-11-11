import { useState } from 'react'
import { JXButton, JXCard, JXSelect, JXSwitch, JXTextField } from '@jacxishippingorg/jx-ui-react'
import { useStore } from '../store/store'
import { fmtMoney } from '../store/types'
import { Alert, Field, PageHeader } from '../components/ui'

export default function Settings() {
  const { state, updateSettings, resetDemo } = useStore()
  const [orgName, setOrgName] = useState(state.settings.orgName)
  const [currency, setCurrency] = useState(state.settings.currency)
  const [overhead, setOverhead] = useState(String(state.settings.overheadPerVehicle))
  const [targetHold, setTargetHold] = useState(String(state.settings.targetHoldDays))
  const [saved, setSaved] = useState('')
  const [saveError, setSaveError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetDone, setResetDone] = useState('')

  const dark = state.settings.theme === 'dark'

  const saveProfile = () => {
    setSaveError(''); setSaved('')
    const oh = Number(overhead)
    const th = Number(targetHold)
    if (!orgName.trim()) { setSaveError('Organisation name cannot be empty.'); return }
    if (Number.isNaN(oh) || oh < 0) { setSaveError('Overhead per vehicle must be a number of 0 or more.'); return }
    if (!Number.isInteger(th) || th <= 0) { setSaveError('Target hold days must be a whole number above 0.'); return }
    updateSettings({ orgName: orgName.trim(), currency: currency.trim() || 'USD', overheadPerVehicle: oh, targetHoldDays: th })
    setSaved('Settings saved. Overhead per vehicle now feeds every vehicle all-in cost; target hold days feeds the aging report.')
  }

  const toggleTheme = (checked: boolean) => {
    const next = checked ? 'dark' : 'light'
    document.documentElement.classList.toggle('dark', checked)
    updateSettings({ theme: next })
  }

  const doReset = () => {
    resetDemo()
    setConfirmReset(false)
    setResetDone('Demo data reset to the original seed. All changes made since the seed — vehicles, sales, payments, documents, team edits — are gone.')
    setOrgName('JX Auto Sales — Demo Dealership')
    setCurrency('USD')
    setOverhead('150')
    setTargetHold('45')
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Organisation profile, costing policy, theme and demo-data controls." />

      <div className="grid gap-6 lg:grid-cols-2">
        <JXCard title="Organisation profile" kicker="Identity" description="Shown in the sidebar and used across the app."
          className="!rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-4">
            <Field label="Organisation name">
              <JXTextField label="" value={orgName} onChange={setOrgName} />
            </Field>
            <Field label="Currency" hint="Money is formatted in USD in this build; the currency label is stored with the organisation.">
              <JXSelect options={[{ id: 'USD', label: 'USD — US Dollar' }, { id: 'AED', label: 'AED — UAE Dirham' }, { id: 'EUR', label: 'EUR — Euro' }, { id: 'GBP', label: 'GBP — British Pound' }]}
                value={currency} onChange={setCurrency} />
            </Field>
            {saveError && <Alert severity="error" title="Cannot save settings" description={saveError} />}
            {saved && <Alert severity="success" title={saved} />}
            <div className="flex justify-end">
              <JXButton variant="contained" onClick={saveProfile}>Save profile</JXButton>
            </div>
          </div>
        </JXCard>

        <JXCard title="Overhead allocation & hold target" kicker="Costing policy" description="How every vehicle all-in cost is built."
          className="!rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-4">
            <Field label="Overhead per vehicle (USD)" hint={`Allocated to every vehicle in vehicleAllInCost. Current: ${fmtMoney(state.settings.overheadPerVehicle)} per vehicle.`}>
              <JXTextField label="" value={overhead} onChange={setOverhead} placeholder="150" />
            </Field>
            <Field label="Target hold days" hint="Vehicles held longer than this are flagged over target in the inventory aging report.">
              <JXTextField label="" value={targetHold} onChange={setTargetHold} placeholder="45" />
            </Field>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              All-in cost = purchase price + auction fees + transport + direct expenses + FIFO parts cost + overhead per vehicle.
            </p>
            {saveError && <Alert severity="error" title="Cannot save settings" description={saveError} />}
            {saved && <Alert severity="success" title={saved} />}
            <div className="flex justify-end">
              <JXButton variant="contained" onClick={saveProfile}>Save costing policy</JXButton>
            </div>
          </div>
        </JXCard>

        <JXCard title="Appearance" kicker="Theme" description="Light or dark across the whole app."
          className="!rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <JXSwitch checked={dark} label={dark ? 'Dark theme' : 'Light theme'}
            helperText="Toggles the 'dark' class on the document element and saves the choice in settings, the same way the header toggle does."
            onChange={toggleTheme} />
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Current theme: <span className="font-semibold text-slate-900 dark:text-white">{state.settings.theme}</span></p>
        </JXCard>

        <JXCard title="Demo data" kicker="Danger zone" description="Start over from the original seed data."
          className="!rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Resetting restores the seed dealership ({state.vehicles.length} vehicles, {state.sales.length} sales and the rest of the demo data as seeded) and discards every change made since.
          </p>
          {resetDone && <div className="mt-3"><Alert severity="success" title={resetDone} /></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            {!confirmReset ? (
              <JXButton variant="outlined" color="error" onClick={() => setConfirmReset(true)}>Reset demo data…</JXButton>
            ) : (
              <>
                <JXButton variant="contained" color="error" onClick={doReset}>Yes, reset everything</JXButton>
                <JXButton variant="outlined" onClick={() => setConfirmReset(false)}>Cancel</JXButton>
              </>
            )}
          </div>
          {confirmReset && <p className="mt-2 text-sm font-semibold text-rose-600">This cannot be undone. Confirm to wipe all local changes and restore the seed.</p>}
        </JXCard>
      </div>

      <JXCard title="Data & honesty" kicker="What this build is — and is not" description="Read before relying on anything here for real business."
        className="mt-6 !rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li><strong className="text-slate-900 dark:text-white">localStorage persistence:</strong> all data lives in your browser's localStorage (key <code className="font-mono text-xs">jx-dealer-tracker-v1</code>). It survives reloads on this browser only — clear site data and it is gone. There is no server copy and no sync between devices.</li>
          <li><strong className="text-slate-900 dark:text-white">Demo seed data:</strong> the vehicles, customers, sales, accounts and documents are invented demo records (labelled DEMO in the sidebar), not a real dealership's books. The reset button above restores them.</li>
          <li><strong className="text-slate-900 dark:text-white">Not in this build:</strong> no Postgres or any other database; no real authentication (the role switcher in the header just changes a label); no server-side role enforcement — role gating here is UI-level only; no object storage, so documents are metadata records with no file bytes; no live MCP server connection; and no voice/OCR features — the AI assistant page is a separate placeholder.</li>
          <li><strong className="text-slate-900 dark:text-white">Money movement:</strong> every balance change goes through the store (recordPayment, transfer, recordExpense, finalizeSale) and writes a journal entry. Balances are always computed from opening balance + signed transactions, never stored.</li>
        </ul>
      </JXCard>
    </>
  )
}
