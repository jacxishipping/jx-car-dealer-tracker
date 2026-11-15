import { useEffect, useRef, useState } from 'react'

/** Fields taken from NHTSA vPIC DecodeVinValues Results[0] when the API returns them. */
export type VinDecode = {
  year?: string
  make?: string
  model?: string
  trim?: string
  bodyType?: string
  engine?: string
}

function text(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || trimmed.toLowerCase() === 'not applicable' || trimmed.toLowerCase() === 'null') return ''
  return trimmed
}

function titleCaseMake(value: string): string {
  if (value !== value.toUpperCase()) return value
  return value
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) => (part && /[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('')
}

function engineLabel(row: Record<string, unknown>): string {
  const liters = text(row.DisplacementL)
  const cylinders = text(row.EngineCylinders)
  const model = text(row.EngineModel)
  return [liters ? `${liters}L` : '', cylinders ? `${cylinders} cyl` : '', model].filter(Boolean).join(' ')
}

export async function decodeVin(vin: string, signal?: AbortSignal): Promise<VinDecode | null> {
  const code = vin.trim().toUpperCase()
  if (code.length !== 17) return null
  const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(code)}?format=json`, { signal })
  if (!response.ok) throw new Error('Could not decode VIN')
  const payload = await response.json() as { Results?: Array<Record<string, unknown>> }
  const row = payload.Results?.[0]
  if (!row) return null
  const decoded: VinDecode = {}
  const year = text(row.ModelYear)
  const make = text(row.Make)
  const model = text(row.Model)
  const trim = text(row.Trim) || text(row.Series)
  const bodyType = text(row.BodyClass)
  const engine = engineLabel(row)
  if (/^\d{4}$/.test(year)) decoded.year = year
  if (make) decoded.make = titleCaseMake(make)
  if (model) decoded.model = model
  if (trim) decoded.trim = trim
  if (bodyType) decoded.bodyType = bodyType
  if (engine) decoded.engine = engine
  return decoded
}

/** Fills vehicle fields when a VIN reaches 17 characters. Fetch failures set the helper text and leave the form editable. */
export function useVinDecode(vin: string, onDecoded: (decoded: VinDecode) => void): string {
  const [hint, setHint] = useState('')
  const onDecodedRef = useRef(onDecoded)
  onDecodedRef.current = onDecoded

  useEffect(() => {
    const code = vin.trim().toUpperCase()
    if (code.length !== 17) {
      setHint('')
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setHint('')
    decodeVin(code, controller.signal)
      .then((decoded) => {
        if (cancelled || !decoded) return
        onDecodedRef.current(decoded)
      })
      .catch(() => {
        if (!cancelled) setHint('Could not decode VIN')
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [vin])

  return hint
}
