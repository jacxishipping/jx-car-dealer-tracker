import {JXAvatar, JXButton, JXSelect} from './JXUI'
// Application shell: collapsible sidebar, top bar (global search, notifications,
// quick-create, role switcher, theme toggle, user menu), main content area.
import { useEffect, useMemo, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useJXTheme } from '@jacxishippingorg/jx-ui-react'
import {
  Bell, Car, ChevronLeft, ChevronRight, ClipboardList, DollarSign, FileText, LayoutDashboard, LogOut, Menu, Moon, Package, Plus, Search, Settings as SettingsIcon, ShoppingCart, Sparkles, Sun, Truck, Users, Wallet, Wrench, X, } from 'lucide-react'

import { AppTextField as JXTextField } from "./AppTextField"
import { useStore } from '../store/store'
import { ROLES, type Role } from '../store/types'
import { can } from '../lib/permissions'
import { useFocusTrap } from './useFocusTrap'

const NAV_SECTIONS = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/inventory', label: 'Inventory', icon: Car },
      { to: '/purchases', label: 'Purchases', icon: ShoppingCart },
      { to: '/transportation', label: 'Transportation', icon: Truck },
      { to: '/reconditioning', label: 'Reconditioning', icon: Wrench },
      { to: '/parts', label: 'Parts', icon: Package },
    ],
  },
  {
    label: 'Sales & CRM',
    items: [
      { to: '/sales', label: 'Sales', icon: DollarSign },
      { to: '/crm', label: 'CRM', icon: Users },
    ],
  },
  {
    label: 'Finance & Insights',
    items: [
      { to: '/expenses', label: 'Expenses', icon: ClipboardList },
      { to: '/finance', label: 'Finance', icon: Wallet },
      { to: '/reports', label: 'Reports', icon: FileText },
      { to: '/documents', label: 'Documents', icon: FileText },
    ],
  },
  {
    label: 'AI & Admin',
    items: [
      { to: '/ai-assistant', label: 'AI Assistant', icon: Sparkles },
      { to: '/team', label: 'Team', icon: Users },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
] as const

const QUICK_CREATE: { to: string; label: string; permission: 'vehicle.create' | 'purchase.create' | 'expense.create' | 'deal.create' | 'customer.create' | 'parts.write' | 'transport.create' }[] = [
  { to: '/inventory/new', label: 'New vehicle', permission: 'vehicle.create' },
  { to: '/purchases/new', label: 'New purchase', permission: 'purchase.create' },
  { to: '/expenses?new=1', label: 'New expense', permission: 'expense.create' },
  { to: '/sales/new', label: 'New deal', permission: 'deal.create' },
  { to: '/crm/new', label: 'New customer', permission: 'customer.create' },
  { to: '/parts?receive=1', label: 'Receive parts', permission: 'parts.write' },
  { to: '/transportation?new=1', label: 'New transport order', permission: 'transport.create' },
]

const SEARCH_PLACEHOLDER = 'Search vehicles, customers, deals, parts…'

type SearchHit = {
  key: string
  kind: 'Vehicle' | 'Customer' | 'Deal' | 'Part'
  label: string
  detail: string
  to: string
}

function SearchResults({ id, hits, onPick }: { id: string; hits: SearchHit[]; onPick: () => void }) {
  if (hits.length === 0) {
    return (
      <div id={id} role="status" className="absolute left-0 right-0 top-full z-40 mt-1 rounded-[var(--radius-card)] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-lg dark:border-slate-700 dark:bg-[var(--color-surface-dark)] dark:text-slate-400">
        No matches.
      </div>
    )
  }
  return (
    <div id={id} role="listbox" aria-label="Search results" className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-[var(--radius-card)] border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
      {hits.map((hit) => (
        <Link
          key={hit.key}
          to={hit.to}
          role="option"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onPick}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            const options = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
            const index = options.indexOf(event.currentTarget)
            const next = options[index + (event.key === 'ArrowDown' ? 1 : -1)]
            if (next) next.focus()
            else if (event.key === 'ArrowUp') event.currentTarget.closest('form')?.querySelector<HTMLElement>('input')?.focus()
          }}
          className="flex items-start gap-3 px-3 py-2 text-left hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800"
        >
          <span className="mt-0.5 w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{hit.kind}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{hit.label}</span>
            {hit.detail && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{hit.detail}</span>}
          </span>
        </Link>
      ))}
    </div>
  )
}

export default function Layout() {
  const { state, setRole, markNotificationRead, updateSettings, apiMode, logout, lastError, clearError } = useStore()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [showBell, setShowBell] = useState(false)
  const [showQuick, setShowQuick] = useState(false)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const headerActionsRef = useRef<HTMLDivElement>(null)
  const mobileDrawerRef = useRef<HTMLElement>(null)
  const quickMenuRef = useRef<HTMLDivElement>(null)
  const bellMenuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const dark = state.settings.theme === 'dark'
  const { setMode } = useJXTheme()
  const unread = state.notifications.filter((n) => !n.read).length
  const quickItems = useMemo(() => QUICK_CREATE.filter(q => can(state.currentRole, q.permission)), [state.currentRole])
  const searchHits = useMemo((): SearchHit[] => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const hits: SearchHit[] = []
    let vehicles = 0
    for (const vehicle of state.vehicles) {
      if (vehicles >= 5) break
      const hay = [vehicle.stockNumber, vehicle.vin, vehicle.year, vehicle.make, vehicle.model, vehicle.trim].join(' ').toLowerCase()
      if (!hay.includes(q)) continue
      vehicles += 1
      hits.push({
        key: `vehicle-${vehicle.id}`,
        kind: 'Vehicle',
        label: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        detail: `${vehicle.stockNumber} · ${vehicle.vin}`,
        to: `/inventory/${vehicle.id}`,
      })
    }
    let customers = 0
    for (const customer of state.customers) {
      if (customers >= 5) break
      const hay = [customer.name, customer.phone, customer.email].join(' ').toLowerCase()
      if (!hay.includes(q)) continue
      customers += 1
      hits.push({
        key: `customer-${customer.id}`,
        kind: 'Customer',
        label: customer.name,
        detail: [customer.phone, customer.email].filter(Boolean).join(' · '),
        to: `/crm?customer=${encodeURIComponent(customer.id)}`,
      })
    }
    let deals = 0
    for (const deal of state.deals) {
      if (deals >= 5) break
      const customer = state.customers.find((item) => item.id === deal.customerId)
      const vehicle = state.vehicles.find((item) => item.id === deal.vehicleId)
      const hay = [deal.ref, deal.status, deal.salesperson, customer?.name, vehicle?.stockNumber, vehicle?.make, vehicle?.model].join(' ').toLowerCase()
      if (!hay.includes(q)) continue
      deals += 1
      const vehicleLabel = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : ''
      hits.push({
        key: `deal-${deal.id}`,
        kind: 'Deal',
        label: deal.ref,
        detail: [customer?.name, vehicleLabel, deal.status].filter(Boolean).join(' · '),
        to: `/sales?deal=${encodeURIComponent(deal.id)}`,
      })
    }
    let parts = 0
    for (const part of state.parts) {
      if (parts >= 5) break
      const hay = [part.sku, part.name, part.manufacturer, part.supplier].join(' ').toLowerCase()
      if (!hay.includes(q)) continue
      parts += 1
      hits.push({
        key: `part-${part.id}`,
        kind: 'Part',
        label: part.name,
        detail: [part.sku, part.manufacturer].filter(Boolean).join(' · '),
        to: '/parts',
      })
    }
    return hits
  }, [query, state.vehicles, state.customers, state.deals, state.parts])
  const showSearchResults = searchOpen && query.trim().length > 0

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    setMode(dark ? 'dark' : 'light')
  }, [dark, setMode])

  useFocusTrap(mobileDrawerRef, mobileOpen, () => setMobileOpen(false))

  // Keep the page from scrolling behind the mobile navigation drawer.
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileOpen])

  // Close Quick create and Notifications popovers on Escape or outside click.
  useEffect(() => {
    if (!showQuick && !showBell) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowQuick(false)
        setShowBell(false)
      }
    }
    const onMouseDown = (e: MouseEvent) => {
      if (headerActionsRef.current && !headerActionsRef.current.contains(e.target as Node)) {
        setShowQuick(false)
        setShowBell(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [showQuick, showBell])

  useEffect(() => {
    if (!showQuick && !showBell) return
    const root = showQuick ? quickMenuRef.current : bellMenuRef.current
    root?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [showQuick, showBell])

  const closeSearch = () => {
    setSearchOpen(false)
    setShowMobileSearch(false)
  }
  const onQueryChange = (value: string) => {
    setQuery(value)
    setSearchOpen(true)
  }
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSearchOpen(false)
    const term = query.trim()
    if (!term) return
    navigate(`/inventory?q=${encodeURIComponent(term)}`)
    setShowMobileSearch(false)
  }
  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      setSearchOpen(false)
      return
    }
    if (event.key !== 'ArrowDown') return
    const first = event.currentTarget.querySelector<HTMLElement>('[role="option"]')
    if (!first) return
    event.preventDefault()
    first.focus()
  }
  const onSearchBlur = (event: FocusEvent<HTMLFormElement>) => {
    const next = event.relatedTarget
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setSearchOpen(false)
  }

  const toggleTheme = () => {
    updateSettings({ theme: dark ? 'light' : 'dark' })
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-white dark:bg-[var(--color-bg-dark)]">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-4 dark:border-slate-800">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white">JX</span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-white">JX Car Dealer Tracker</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Dealership OS · <span className={`font-semibold ${apiMode ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>{apiMode ? 'LIVE API' : 'DEMO DATA'}</span></p>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_SECTIONS.map((section, idx) => (
          <div key={section.label} className={idx > 0 ? 'mt-3 border-t border-slate-200 pt-3 dark:border-slate-800' : ''}>
            {!collapsed && (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {section.label}
              </p>
            )}
            {section.items.map((item) => {
              const Icon = item.icon
              const end = 'end' in item ? item.end : false
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={end}
                  title={collapsed ? item.label : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `mb-0.5 flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`
                  }
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <JXAvatar name={state.currentUser} size="sm" status="online" />
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{state.currentUser}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{state.currentRole} · {state.settings.orgName}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-[var(--color-bg-light)] dark:bg-[var(--color-bg-dark)]">
      {/* Desktop sidebar — off-canvas drawer below lg so tablets get the full width */}
      <aside className={`fixed inset-y-0 left-0 z-40 hidden border-r border-slate-200 transition-all lg:block dark:border-slate-800 ${collapsed ? 'w-16' : 'w-64'}`}>
        {sidebar}
      </aside>
      <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar"
        className="fixed bottom-4 left-4 z-40 hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-md hover:bg-slate-50 lg:inline-flex dark:border-slate-700 dark:bg-[var(--color-surface-dark)] dark:text-slate-200 dark:hover:bg-slate-800">
        {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
      </button>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 h-full w-full cursor-default bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside id="main-navigation" ref={mobileDrawerRef} role="dialog" aria-modal="true" aria-label="Main navigation" tabIndex={-1} className="absolute inset-y-0 left-0 w-72 focus:outline-none">
            {sidebar}
            <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu" className="absolute right-2 top-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"><X className="h-5 w-5" /></button>
          </aside>
        </div>
      )}

      <div className={`flex min-w-0 flex-1 flex-col ${collapsed ? 'lg:pl-16' : 'lg:pl-64'}`}>
        <header className="sticky top-0 z-30 flex min-w-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 sm:px-5">
          <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] text-slate-700 hover:bg-slate-100 lg:hidden dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setMobileOpen(true)} aria-label="Open menu" aria-expanded={mobileOpen} aria-controls="main-navigation">
            <Menu className="h-5 w-5" />
          </button>
          <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] text-slate-700 hover:bg-slate-100 sm:hidden dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setShowMobileSearch((s) => !s)} aria-label="Search">
            <Search className="h-5 w-5" />
          </button>
          <form
            className="relative hidden min-w-0 flex-1 sm:block"
            role="search"
            onSubmit={submitSearch}
            onFocus={() => setSearchOpen(true)}
            onBlur={onSearchBlur}
            onKeyDown={onSearchKeyDown}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
            <JXTextField
              id="header-vehicle-search"
              className="jx-text-field jx-global-search"
              label=""
              value={query}
              onChange={onQueryChange}
              placeholder={SEARCH_PLACEHOLDER}
              aria-label="Search vehicles, customers, deals, parts"
              aria-autocomplete="list"
              aria-expanded={showSearchResults}
              aria-controls={showSearchResults ? 'header-search-results' : undefined}
              autoComplete="off"
            />
            {showSearchResults && <SearchResults id="header-search-results" hits={searchHits} onPick={closeSearch} />}
          </form>
          {showMobileSearch && (
            <form
              className="relative order-10 w-full sm:hidden"
              role="search"
              onSubmit={submitSearch}
              onFocus={() => setSearchOpen(true)}
              onBlur={onSearchBlur}
              onKeyDown={onSearchKeyDown}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
              <JXTextField
                id="mobile-header-vehicle-search"
                className="jx-text-field jx-global-search"
                label=""
                value={query}
                onChange={onQueryChange}
                autoFocus
                placeholder={SEARCH_PLACEHOLDER}
                aria-label="Search vehicles, customers, deals, parts"
                aria-autocomplete="list"
                aria-expanded={showSearchResults}
                aria-controls={showSearchResults ? 'mobile-header-search-results' : undefined}
                autoComplete="off"
              />
              {showSearchResults && <SearchResults id="mobile-header-search-results" hits={searchHits} onPick={closeSearch} />}
            </form>
          )}
          <div ref={headerActionsRef} className="ml-auto flex items-center gap-1.5">
            {quickItems.length > 0 && (
              <div className="relative">
                <JXButton variant="outlined" size="sm" lockWidth={false} className="!min-h-[44px] !min-w-[44px]" onClick={() => { setShowQuick((s) => !s); setShowBell(false) }} aria-expanded={showQuick} aria-haspopup="menu" aria-controls={showQuick ? 'quick-create-menu' : undefined}>
                  <span className="inline-flex items-center gap-1"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Quick create</span></span>
                </JXButton>
                {showQuick && (
                  <div ref={quickMenuRef} id="quick-create-menu" role="menu" aria-label="Quick create" className="absolute right-0 mt-2 w-48 rounded-[var(--radius-card)] border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                    {quickItems.map((q) => (
                      <Link key={q.label} to={q.to} role="menuitem" onClick={() => setShowQuick(false)} className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:bg-slate-800">{q.label}</Link>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="relative">
              <button type="button" onClick={() => { setShowBell((s) => !s); setShowQuick(false) }} aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={showBell} aria-haspopup="menu" aria-controls={showBell ? 'notification-menu' : undefined} className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unread}</span>}
              </button>
              {showBell && (
                <div ref={bellMenuRef} id="notification-menu" role="menu" aria-label="Notifications" className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-[var(--radius-card)] border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-[var(--color-surface-dark)]">
                  {state.notifications.length === 0 && <p className="p-3 text-sm text-slate-500 dark:text-slate-400">No notifications.</p>}
                  {state.notifications.map((n) => (
                    <button type="button" role="menuitem" key={n.id} onClick={() => { markNotificationRead(n.id); setShowBell(false); if (n.to) navigate(n.to) }} className="block w-full rounded-[var(--radius-control)] p-2 text-left hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800">
                      <p className={`text-sm font-semibold ${n.read ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white'}`}>{n.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{n.detail}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!apiMode ? (
              <div className="hidden md:flex items-center gap-1.5" title="Simulated client-side role preview">
                <span
                  title="Simulated client-side role preview"
                  className="shrink-0 rounded-[var(--radius-pill)] bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  Demo Role
                </span>
                <div className="w-36">
                  <JXSelect
                    label="Demo Role"
                    className="jx-select-field jx-sr-label jx-header-select"
                    options={ROLES.map((r) => ({ id: r, label: r }))}
                    value={state.currentRole}
                    onChange={(v) => setRole(v as Role)}
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={logout}
                aria-label="Sign out"
                title="Sign out"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            )}
            <button type="button" onClick={toggleTheme} aria-label="Toggle theme" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
              {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-3 py-5 sm:px-6">
          {lastError && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
              <div className="flex-1">
                <p className="font-semibold">Server request failed</p>
                <p className="text-xs">{lastError}</p>
              </div>
              <button type="button" onClick={clearError} aria-label="Dismiss error" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] hover:bg-rose-100 dark:hover:bg-rose-900">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <Outlet />
        </main>
        <footer className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          {apiMode
            ? `JX Car Dealer Tracker · Connected to API backend (${state.settings.orgName}).`
            : 'JX Car Dealer Tracker · DEMO environment — seed data is labelled demo and stored locally in your browser. No production backend is connected.'}
        </footer>
      </div>
    </div>
  )
}
