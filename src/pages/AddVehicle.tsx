import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, CarFront, CircleDollarSign, ClipboardList } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { AppTextField as JXTextField } from '../components/AppTextField'
import { JXButton, JXCard, JXNumberField, JXSelect, JXStepper, JXTextareaAutosize } from '../components/JXUI'
import { Alert, Field, PageHeader, inputCls } from '../components/ui'
import { useStore } from '../store/store'
import type { Vehicle, VehicleStatus } from '../store/types'
import { VEHICLE_STATUSES } from '../store/types'

const steps = [
  { id: 'vehicle', label: 'Vehicle', description: 'Identification and specifications' },
  { id: 'acquisition', label: 'Acquisition', description: 'Purchase and pricing details' },
  { id: 'details', label: 'Details', description: 'Photos and internal notes' },
]
const CURRENT_YEAR = new Date().getFullYear()

const initialForm = () => ({
  stockNumber: '', vin: '', year: String(new Date().getFullYear()), make: '', model: '', trim: '',
  extColor: '', intColor: '', mileage: '0', transmission: 'Automatic', engine: '', fuel: 'Petrol',
  drivetrain: 'FWD', bodyType: 'Sedan', condition: 'Good' as Vehicle['condition'],
  titleStatus: 'Clean' as Vehicle['titleStatus'], status: 'Purchased' as VehicleStatus,
  purchaseDate: new Date().toISOString().slice(0, 10), purchaseSource: 'Auction' as Vehicle['purchaseSource'],
  purchasePrice: '0', auctionFees: '0', transportCost: '0', askingPrice: '0', minPrice: '0',
  photos: '', notes: '',
})

export default function AddVehicle() {
  const { addVehicle } = useStore()
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key: keyof ReturnType<typeof initialForm>, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const setNumber = (key: 'year' | 'mileage' | 'purchasePrice' | 'auctionFees' | 'transportCost' | 'askingPrice' | 'minPrice', value: number) => set(key, String(value))

  const estimatedCost = useMemo(() => ['purchasePrice', 'auctionFees', 'transportCost'].reduce((sum, key) => sum + (Number(form[key as 'purchasePrice' | 'auctionFees' | 'transportCost']) || 0), 0), [form])

  const validateStep = () => {
    setError('')
    if (step === 0) {
      if (!form.stockNumber.trim() || !form.vin.trim() || !form.make.trim() || !form.model.trim()) {
        setError('Enter a stock number, VIN, make, and model to continue.')
        return false
      }
      if (form.vin.trim().length < 11 || form.vin.trim().length > 17) {
        setError('VIN must contain 11–17 characters.')
        return false
      }
      if (!Number.isInteger(Number(form.year)) || Number(form.year) < 1886 || Number(form.year) > new Date().getFullYear() + 2) {
        setError('Enter a valid model year.')
        return false
      }
    }
    if (step === 1) {
      if (!form.purchaseDate) { setError('Choose the purchase date to continue.'); return false }
      const amounts = [form.purchasePrice, form.auctionFees, form.transportCost, form.askingPrice, form.minPrice]
      if (amounts.some((amount) => !Number.isFinite(Number(amount)) || Number(amount) < 0)) {
        setError('Prices and costs must be zero or greater.')
        return false
      }
    }
    return true
  }

  const next = () => { if (validateStep()) setStep((current) => Math.min(2, current + 1)) }

  const submit = () => {
    if (!validateStep()) return
    setBusy(true)
    const vehicle: Omit<Vehicle, 'id' | 'createdAt'> = {
      stockNumber: form.stockNumber.trim(), vin: form.vin.trim().toUpperCase(),
      year: Number(form.year), make: form.make.trim(), model: form.model.trim(), trim: form.trim.trim(),
      extColor: form.extColor.trim(), intColor: form.intColor.trim(), mileage: Number(form.mileage) || 0,
      transmission: form.transmission, engine: form.engine.trim(), fuel: form.fuel,
      drivetrain: form.drivetrain, bodyType: form.bodyType, condition: form.condition,
      titleStatus: form.titleStatus, status: form.status, purchaseDate: form.purchaseDate,
      purchaseSource: form.purchaseSource, purchasePrice: Number(form.purchasePrice) || 0,
      auctionFees: Number(form.auctionFees) || 0, transportCost: Number(form.transportCost) || 0,
      askingPrice: Number(form.askingPrice) || 0, minPrice: Number(form.minPrice) || 0,
      photos: form.photos.split(',').map((photo) => photo.trim()).filter(Boolean), notes: form.notes.trim(),
    }
    const result = addVehicle(vehicle)
    setBusy(false)
    if (!result.ok) { setError(result.error ?? 'Could not add vehicle.'); return }
    if (result.id) navigate(`/inventory/${result.id}`)
    else navigate('/inventory')
  }

  return (
    <>
      <PageHeader title="Add vehicle" subtitle="Add a vehicle to inventory in three short steps." actions={
        <JXButton variant="outlined" lockWidth={false} onClick={() => navigate('/inventory')}><span className="inline-flex items-center gap-2"><ArrowLeft className="h-4 w-4" /> Back to inventory</span></JXButton>
      } />

      <div className="mx-auto max-w-4xl">
        <JXCard className="jx-vehicle-wizard-card">
          <div className="space-y-6 p-4 sm:p-6">
            <JXStepper className="jx-app-stepper--progress-only" steps={steps} activeStep={step} nonLinear={false} onStepChange={(nextStep) => { if (nextStep <= step) { setError(''); setStep(nextStep) } }} />

            {error && <Alert severity="error" title="Check the vehicle details" description={error} />}

            {step === 0 && <section aria-labelledby="vehicle-step-title">
              <div className="mb-5 flex items-start gap-3"><span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300"><CarFront className="h-5 w-5" /></span><div><h2 id="vehicle-step-title" className="text-lg font-semibold text-slate-900 dark:text-white">Vehicle identification</h2><p className="text-sm text-slate-500 dark:text-slate-400">Start with the details staff use to find this vehicle.</p></div></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Stock number"><JXTextField label="" className="jx-text-field" value={form.stockNumber} onChange={(value) => set('stockNumber', value)} placeholder="e.g. CDT-204" /></Field>
                <Field label="VIN" hint="11–17 characters. VINs must be unique."><JXTextField label="" className="jx-text-field" value={form.vin} onChange={(value) => set('vin', value.toUpperCase())} placeholder="Enter vehicle identification number" maxLength={17} /></Field>
                <Field label="Year"><JXNumberField label="" value={Number(form.year)} min={1886} max={CURRENT_YEAR + 2} step={1} unit="" onChange={(value) => setNumber('year', value)} size="md" /></Field>
                <Field label="Make"><JXTextField label="" className="jx-text-field" value={form.make} onChange={(value) => set('make', value)} placeholder="e.g. Honda" /></Field>
                <Field label="Model"><JXTextField label="" className="jx-text-field" value={form.model} onChange={(value) => set('model', value)} placeholder="e.g. Accord" /></Field>
                <Field label="Trim (optional)"><JXTextField label="" className="jx-text-field" value={form.trim} onChange={(value) => set('trim', value)} placeholder="e.g. Sport" /></Field>
                <Field label="Mileage"><JXNumberField label="" value={Number(form.mileage)} min={0} max={2_000_000} step={1000} unit="mi" onChange={(value) => setNumber('mileage', value)} size="md" /></Field>
                <JXSelect label="Condition" className="jx-select-field jx-field-select" value={form.condition} options={(['Excellent', 'Good', 'Fair', 'Poor'] as const).map((value) => ({ id: value, label: value }))} onChange={(value) => set('condition', value)} />
              </div>
              <details className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">More vehicle specifications</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Exterior color"><JXTextField label="" className="jx-text-field" value={form.extColor} onChange={(value) => set('extColor', value)} /></Field>
                <Field label="Interior color"><JXTextField label="" className="jx-text-field" value={form.intColor} onChange={(value) => set('intColor', value)} /></Field>
                <Field label="Transmission"><JXTextField label="" className="jx-text-field" value={form.transmission} onChange={(value) => set('transmission', value)} /></Field>
                <Field label="Engine"><JXTextField label="" className="jx-text-field" value={form.engine} onChange={(value) => set('engine', value)} /></Field>
                <Field label="Fuel"><JXTextField label="" className="jx-text-field" value={form.fuel} onChange={(value) => set('fuel', value)} /></Field>
                <Field label="Drivetrain"><JXTextField label="" className="jx-text-field" value={form.drivetrain} onChange={(value) => set('drivetrain', value)} /></Field>
                <Field label="Body type"><JXTextField label="" className="jx-text-field" value={form.bodyType} onChange={(value) => set('bodyType', value)} /></Field>
                <JXSelect label="Title status" className="jx-select-field jx-field-select" value={form.titleStatus} options={(['Clean', 'Salvage', 'Rebuilt', 'Lien', 'Missing'] as const).map((value) => ({ id: value, label: value }))} onChange={(value) => set('titleStatus', value)} />
              </div></details>
            </section>}

            {step === 1 && <section aria-labelledby="acquisition-step-title">
              <div className="mb-5 flex items-start gap-3"><span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><CircleDollarSign className="h-5 w-5" /></span><div><h2 id="acquisition-step-title" className="text-lg font-semibold text-slate-900 dark:text-white">Purchase and pricing</h2><p className="text-sm text-slate-500 dark:text-slate-400">Capture acquisition costs and set the first asking price.</p></div></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <JXSelect label="Purchase source" className="jx-select-field jx-field-select" value={form.purchaseSource} options={(['Auction', 'Wholesale', 'Private seller', 'Trade-in', 'Other dealer'] as const).map((value) => ({ id: value, label: value }))} onChange={(value) => set('purchaseSource', value)} />
                <JXSelect label="Starting status" className="jx-select-field jx-field-select" value={form.status} options={VEHICLE_STATUSES.map((value) => ({ id: value, label: value }))} onChange={(value) => set('status', value)} />
                <Field label="Purchase date"><input className={inputCls} type="date" value={form.purchaseDate} onChange={(event) => set('purchaseDate', event.target.value)} /></Field>
                <Field label="Purchase price (USD)"><JXNumberField label="" value={Number(form.purchasePrice)} min={0} max={1_000_000_000} step={100} unit="USD" onChange={(value) => setNumber('purchasePrice', value)} size="md" /></Field>
                <Field label="Auction fees (USD)"><JXNumberField label="" value={Number(form.auctionFees)} min={0} max={1_000_000_000} step={25} unit="USD" onChange={(value) => setNumber('auctionFees', value)} size="md" /></Field>
                <Field label="Transport cost (USD)"><JXNumberField label="" value={Number(form.transportCost)} min={0} max={1_000_000_000} step={25} unit="USD" onChange={(value) => setNumber('transportCost', value)} size="md" /></Field>
                <Field label="Asking price (USD)"><JXNumberField label="" value={Number(form.askingPrice)} min={0} max={1_000_000_000} step={100} unit="USD" onChange={(value) => setNumber('askingPrice', value)} size="md" /></Field>
                <Field label="Minimum price (USD)"><JXNumberField label="" value={Number(form.minPrice)} min={0} max={1_000_000_000} step={100} unit="USD" onChange={(value) => setNumber('minPrice', value)} size="md" /></Field>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-900"><span className="text-sm text-slate-600 dark:text-slate-300">Known acquisition cost</span><strong className="font-mono text-lg text-slate-900 dark:text-white">${estimatedCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></div>
            </section>}

            {step === 2 && <section aria-labelledby="details-step-title">
              <div className="mb-5 flex items-start gap-3"><span className="rounded-xl bg-sky-50 p-2.5 text-sky-700 dark:bg-sky-950 dark:text-sky-300"><ClipboardList className="h-5 w-5" /></span><div><h2 id="details-step-title" className="text-lg font-semibold text-slate-900 dark:text-white">Photos and notes</h2><p className="text-sm text-slate-500 dark:text-slate-400">Add optional reference information for your team.</p></div></div>
              <div className="space-y-4">
                <Field label="Photo names" hint="Optional comma-separated names; uploads are managed in Documents."><JXTextField label="" className="jx-text-field" value={form.photos} onChange={(value) => set('photos', value)} placeholder="front.jpg, interior.jpg" /></Field>
                <Field label="Internal notes" hint="Visible to your team on this vehicle record."><JXTextareaAutosize className="jx-app-textarea w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white" minRows={4} maxRows={10} value={form.notes} onChange={(value) => set('notes', value)} placeholder="Condition details, included accessories, or other useful context…" /></Field>
              </div>
              <div className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-sm font-semibold text-slate-900 dark:text-white">Ready to add</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{form.year} {form.make || 'Make'} {form.model || 'Model'} · {form.stockNumber || 'Stock number'} · VIN {form.vin || '—'}</p><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Initial status: {form.status}</p></div>
            </section>}

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
              <JXButton variant="text" lockWidth={false} onClick={() => step === 0 ? navigate('/inventory') : setStep((current) => current - 1)}>{step === 0 ? 'Cancel' : 'Back'}</JXButton>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {step < 2 ? <JXButton variant="contained" lockWidth={false} onClick={next} className="w-full sm:w-auto">Continue <ArrowRight className="ml-2 h-4 w-4" /></JXButton> : <JXButton variant="contained" lockWidth={false} disabled={busy} onClick={submit} className="w-full sm:w-auto">{busy ? 'Adding vehicle…' : 'Add vehicle'}</JXButton>}
              </div>
            </div>
          </div>
        </JXCard>
      </div>
    </>
  )
}
