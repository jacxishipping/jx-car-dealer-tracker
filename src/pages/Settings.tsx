import { useState } from 'react'

import { AppTextField as JXTextField } from "../components/AppTextField"
import { useStore } from '../store/store'
import { fmtMoney } from '../store/types'
import { Alert, Field, PageHeader } from '../components/ui'

import {JXButton, JXCard, JXSelect, JXSwitch} from '../components/JXUI'
export default function Settings() {
  const { state, updateSettings, resetDemo, apiMode } = useStore()
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
      <PageHeader title="Settings" subtitle={apiMode ? 'Organisation profile, costing policy, theme and connected workspace.' : 'Organisation profile, costing policy, theme and demo-data controls.'} />

      <div className="grid gap-6 lg:grid-cols-2">
        <JXCard title="Organisation profile" kicker="Identity" description="Shown in the sidebar and used across the app."
          className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
          <div className="space-y-4">
              <Field label="Organisation name" htmlFor="settings-org-name">
                <JXTextField id="settings-org-name" className="jx-text-field" label="" value={orgName} onChange={setOrgName} />
              </Field>
              <div>
                <JXSelect
                  label="Currency"
                  className="jx-select-field jx-field-select"
                  options={[{ id: 'USD', label: 'USD — US Dollar' }, { id: 'AED', label: 'AED — UAE Dirham' }, { id: 'EUR', label: 'EUR — Euro' }, { id: 'GBP', label: 'GBP — British Pound' }]}
                  value={currency}
                  onChange={setCurrency}
                />
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  Money is formatted in USD in this build; the currency label is stored with the organisation.
                </span>
              </div>
              <div className="flex justify-end">
                <JXButton variant="contained" lockWidth={false} onClick={saveProfile} className="w-full sm:w-auto">Save profile</JXButton>
              </div>
          </div>
        </JXCard>

        <JXCard title="Overhead allocation & hold target" kicker="Costing policy" description="How every vehicle all-in cost is built."
          className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
          <div className="space-y-4">
              <Field label="Overhead per vehicle (USD)" htmlFor="settings-overhead" hint={`Allocated to every vehicle in vehicleAllInCost. Current: ${fmtMoney(state.settings.overheadPerVehicle)} per vehicle.`}>
                <JXTextField id="settings-overhead" className="jx-text-field" label="" value={overhead} onChange={setOverhead} placeholder="150" />
              </Field>
                <Field label="Target hold days" htmlFor="settings-target-hold" hint="Vehicles held longer than this are flagged over target in the inventory aging report.">
                  <JXTextField id="settings-target-hold" className="jx-text-field" label="" value={targetHold} onChange={setTargetHold} placeholder="45" />
                </Field>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  All-in cost = purchase price + auction fees + transport + direct expenses + FIFO parts cost + overhead per vehicle.
                </p>
                <div className="flex justify-end">
                  <JXButton variant="contained" lockWidth={false} onClick={saveProfile} className="w-full sm:w-auto">Save costing policy</JXButton>
                </div>
              </div>
            </JXCard>

            <JXCard title="Appearance" kicker="Theme" description="Light or dark across the whole app."
          className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
              <JXSwitch checked={dark} label={dark ? 'Dark theme' : 'Light theme'}
                helperText="Toggles the 'dark' class on the document element and saves the choice in settings, the same way the header toggle does."
                onChange={toggleTheme} />
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Current theme: <span className="font-semibold text-slate-900 dark:text-white">{state.settings.theme}</span></p>
            </JXCard>

            <JXCard title="Demo data" kicker="Danger zone" description="Start over from the original seed data."
          className="!rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Resetting restores the seed dealership ({state.vehicles.length} vehicles, {state.sales.length} sales and the rest of the demo data as seeded) and discards every change made since.
              </p>
              {resetDone && <div className="mt-3"><Alert severity="success" title={resetDone} /></div>}
              <div className="mt-4 flex flex-wrap gap-2">
                {!confirmReset ? (
              <JXButton variant="outlined" color="error" lockWidth={false} onClick={() => setConfirmReset(true)}>Reset demo data…</JXButton>
                ) : (
                  <>
                    <JXButton variant="contained" color="error" lockWidth={false} onClick={doReset}>Yes, reset everything</JXButton>
                    <JXButton variant="outlined" lockWidth={false} onClick={() => setConfirmReset(false)}>Cancel</JXButton>
                  </>
                )}
              </div>
              {confirmReset && <p className="mt-2 text-sm font-semibold text-rose-600 dark:text-rose-400">This cannot be undone. Confirm to wipe all local changes and restore the seed.</p>}
            </JXCard>
          </div>

          {(saveError || saved) && <div className="mt-4" role="status" aria-live="polite">
            {saveError ? <Alert severity="error" title="Cannot save settings" description={saveError} /> : <Alert severity="success" title={saved} />}
          </div>}

          <JXCard title="Data & availability" kicker={apiMode ? 'Connected workspace' : 'Demo workspace'} description="Understand where records are stored and which integrations are active."
        className="mt-6 !rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
            <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600 dark:text-slate-300">
              {apiMode ? (
                <li><strong className="text-slate-900 dark:text-white">Connected API:</strong> dealership records are loaded from and saved to the configured backend. Data retention, backups, and account permissions follow that deployment&apos;s configuration.</li>
              ) : (
                <>
                  <li><strong className="text-slate-900 dark:text-white">Browser-only demo data:</strong> records are stored in this browser&apos;s localStorage and do not sync to other devices. Clearing site data removes local changes.</li>
                  <li><strong className="text-slate-900 dark:text-white">Invented seed records:</strong> the vehicles, customers, sales, accounts, and documents are demo examples, not a real dealership&apos;s books. Reset restores the original sample data.</li>
                </>
              )}
              <li><strong className="text-slate-900 dark:text-white">Integrations:</strong> document entries store metadata only (no uploaded file bytes); MCP is not connected to a live server. The assistant can parse typed commands, but receipt photos are not processed with OCR and voice input depends on browser support.</li>
              {!apiMode && <li><strong className="text-slate-900 dark:text-white">Demo roles:</strong> the header role switcher is a local preview and does not provide server-side access control.</li>}
              <li><strong className="text-slate-900 dark:text-white">Money movement:</strong> every balance change goes through the store (recordPayment, transfer, recordExpense, finalizeSale) and writes a journal entry. Balances are always computed from opening balance + signed transactions, never stored.</li>
            </ul>
          </JXCard>
        </>
        )
}
