// Shared UI primitives. JXUI components are used where their real API fits
// (verified against node_modules/@jacxishippingorg/jx-ui-react/dist-lib/types):
//  JXCard {title, kicker, description, children}, JXButton {variant, size, color,
//  onClick}, JXChip {label, tone}, JXTextField {value, onChange(val), label},
//  JXSelect {options:[{id,label}], value, onChange(val), label, placeholder},
//  JXAlert {severity, title, description}, JXAvatar {name, role, status, size},
//  JXSwitch {checked, onChange(checked), label}.
// NOT used: JXTable (its rows are a fixed {service, env, latency, commit, detail}
// shape — not a generic table), JXBadge (count badge, not a status pill).
// Tables, modals and charts below are local, styled to the JXUI language
// (Indigo #4f46e5, light canvas #F8FAFC, white 16px cards, Plus Jakarta Sans).
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { JXAlert, JXButton, JXCard, JXChip } from '@jacxishippingorg/jx-ui-react'
import { Download, SearchX, X } from 'lucide-react'
import { fmtMoney } from '../store/types'
import { downloadCsv } from '../lib/csv'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function KpiCard({ label, value, sub, tone = 'indigo' }: { label: string; value: string; sub?: string; tone?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky' }) {
  const bar: Record<string, string> = {
    indigo: 'bg-indigo-600', emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', sky: 'bg-sky-500',
  }
  return (
    <JXCard className="overflow-hidden !rounded-[var(--radius-card)] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
      <div className={`h-1 ${bar[tone]}`} />
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-white">{value}</p>
        {sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
    </JXCard>
  )
}

const chipTone: Record<string, 'neutral' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky'> = {
  Available: 'emerald', Sold: 'indigo', 'In transit': 'sky', 'In reconditioning': 'amber',
  Reserved: 'indigo', Purchased: 'neutral', Received: 'emerald', Inspection: 'amber',
  'Awaiting pickup': 'amber', Returned: 'rose', Wholesale: 'neutral',
  Delivered: 'emerald', Delayed: 'rose', Cancelled: 'rose', Scheduled: 'sky', 'Picked up': 'sky',
  Paid: 'emerald', Pending: 'amber', Partial: 'amber', Unpaid: 'rose', Open: 'sky', Overdue: 'rose',
  Done: 'emerald', 'In progress': 'amber', 'Not started': 'neutral',
  Draft: 'neutral', Negotiation: 'amber', Finalized: 'emerald',
  'New Lead': 'sky', Contacted: 'indigo', Viewing: 'amber', Lost: 'rose',
  Active: 'emerald', Closed: 'neutral',
}

export function StatusChip({ value }: { value: string }) {
  return <JXChip label={value} tone={chipTone[value] ?? 'neutral'} />
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
      <SearchX className="h-8 w-8 text-slate-500 dark:text-slate-400" />
      <p className="mt-3 font-semibold text-slate-900 dark:text-white">{title}</p>
      {detail && <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Alert({ severity, title, description }: { severity: 'warning' | 'success' | 'info' | 'error'; title: string; description?: string }) {
  return <JXAlert severity={severity} title={title} description={description} />
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  // Close on Escape and move initial focus into the dialog; full-screen sheet
  // on phones (dynamic viewport height so mobile browser chrome never clips
  // the dialog), centred on desktop.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`max-h-dvh w-full overflow-y-auto rounded-t-[var(--radius-card)] bg-white shadow-xl focus:outline-none dark:bg-[var(--color-surface-dark)] ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} sm:max-h-[90vh] sm:rounded-[var(--radius-card)]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  const rawId = useId()
  const targetId = htmlFor ?? `field-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const child = isValidElement<{ id?: string }>(children)
    ? cloneElement(children, { id: children.props.id ?? targetId })
    : children
  return (
    <div className="block">
      <label htmlFor={targetId} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</label>
      {child}
      {hint && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </div>
  )
}

export function TableScrollHint() {
  return <p className="mb-1 text-xs text-slate-500 dark:text-slate-400 sm:hidden">Swipe horizontally to view all columns</p>
}

export const inputCls = 'w-full rounded-[var(--radius-control)] border border-slate-300 bg-white px-3 py-2 text-base md:text-sm text-slate-900 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:focus:border-indigo-400 dark:focus:ring-indigo-500/20'
export const selectCls = inputCls

export function ExportButton({ filename, rows, label = 'Export CSV' }: { filename: string; rows: Record<string, string | number | null | undefined>[]; label?: string }) {
  return (
    <JXButton variant="outlined" size="sm" lockWidth={false} onClick={() => downloadCsv(filename, rows)}>
      <span className="inline-flex items-center gap-1.5"><Download className="h-4 w-4" />{label}</span>
    </JXButton>
  )
}

export function Money({ value, className }: { value: number; className?: string }) {
  return <span className={`font-mono ${className ?? ''}`}>{fmtMoney(value)}</span>
}

/** Simple SVG bar chart — data-driven, no fake series. */
export function BarChart({ data, height = 180 }: { data: { label: string; value: number; value2?: number }[]; height?: number }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.value, d.value2 ?? 0]))
  const w = 560
  const bw = Math.min(48, (w / data.length) * 0.32)
  return (
    <svg viewBox={`0 0 ${w} ${height + 24}`} className="w-full" role="img" aria-label="Bar chart">
      <line x1={0} y1={height} x2={w} y2={height} stroke="#cbd5e1" strokeWidth="1" />
      {data.map((d, i) => {
        const x = (i + 0.5) * (w / data.length)
        const h = (d.value / max) * height
        const h2 = ((d.value2 ?? 0) / max) * height
        return (
          <g key={d.label}>
            <rect x={x - bw} y={height - h} width={bw} height={h} rx={4} fill="#4f46e5">
              <title>{`${d.label}: ${fmtMoney(d.value)}`}</title>
            </rect>
            {d.value2 !== undefined && (
              <rect x={x + 2} y={height - h2} width={bw} height={h2} rx={4} fill="#10b981">
                <title>{`${d.label} (profit): ${fmtMoney(d.value2)}`}</title>
              </rect>
            )}
            <text x={x} y={height + 16} textAnchor="middle" fontSize="11" fill="#64748b">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Simple SVG donut — segments must sum to the total shown. */
export function Donut({ segments, total, label }: { segments: { label: string; value: number; color: string }[]; total: number; label: string }) {
  const r = 70
  const c = 2 * Math.PI * r
  const arcs = segments.reduce<{ items: (typeof segments[number] & { frac: number; offset: number })[]; offset: number }>(
    (acc, s) => {
      const frac = total > 0 ? s.value / total : 0
      acc.items.push({ ...s, frac, offset: acc.offset })
      acc.offset += frac
      return acc
    },
    { items: [], offset: 0 },
  ).items
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width="170" height="170" viewBox="0 0 170 170" role="img" aria-label={label}>
        <circle cx="85" cy="85" r={r} fill="none" stroke="#e2e8f0" strokeWidth="18" />
        {arcs.map((s) => (
          <circle key={s.label} cx="85" cy="85" r={r} fill="none" stroke={s.color} strokeWidth="18"
            strokeDasharray={`${s.frac * c} ${c}`} strokeDashoffset={-s.offset * c} transform="rotate(-90 85 85)" />
        ))}
        <text x="85" y="82" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor">{total}</text>
        <text x="85" y="100" textAnchor="middle" fontSize="10" fill="#64748b">{label}</text>
      </svg>
      <ul className="space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-slate-600 dark:text-slate-300">{s.label}</span>
            <span className="ml-auto font-mono font-semibold">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function usePagination<T>(items: T[], perPage = 10) {
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(items.length / perPage))
  const safePage = Math.min(page, pages)
  const pageItems = items.slice((safePage - 1) * perPage, safePage * perPage)
  const controls = items.length > perPage ? (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-slate-500 dark:text-slate-400">Page {safePage} of {pages} — {items.length} records</span>
      <div className="flex gap-2">
        <JXButton variant="outlined" size="sm" lockWidth={false} disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</JXButton>
        <JXButton variant="outlined" size="sm" lockWidth={false} disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>Next</JXButton>
      </div>
    </div>
  ) : null
  return { pageItems, controls, reset: () => setPage(1) }
}
