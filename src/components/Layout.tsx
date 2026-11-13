// Application shell: collapsible sidebar, top bar (global search, notifications,
// quick-create, role switcher, theme toggle, user menu), main content area.
// JXUI: JXAvatar + JXSelect (verified APIs) + JXButton. Theme is applied by
// toggling the `dark` class on <html> and by JXThemeProvider in main.tsx.
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  BarChart3, Bell, Car, ChevronLeft, ChevronRight, ClipboardList, DollarSign,
  FileText, LayoutDashboard, LogOut, Menu, Moon, Package, Plus, Search, Settings as SettingsIcon,
  ShoppingCart, Sparkles, Truck, Users, Wallet, Wrench, X,
} from 'lucide-react'
import { JXAvatar, JXButton, JXSelect } from '@jacxishippingorg/jx-ui-react'
import { useStore } from '../store/store'
import { ROLES } from '../store/types'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Inventory', icon: Car },
  { to: '/purchases', label: 'Purchases', icon: ShoppingCart },
  { to: '/transportation', label: 'Transportation', icon: Truck },
  { to: '/expenses', label: 'Expenses', icon: ClipboardList },
  { to: '/reconditioning', label: 'Reconditioning', icon: Wrench },
  { to: '/sales', label: 'Sales', icon: DollarSign },
  { to: '/crm', label: 'CRM / Clients', icon: Users },
  { to: '/parts', label: 'Parts Inventory', icon: Package },
  { to: '/finance', label: 'Finance', icon: Wallet },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/team', label: 'Team & Permissions', icon: Users },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

const QUICK_CREATE = [
  { to: '/inventory', label: 'New vehicle' },
  { to: '/purchases', label: 'New purchase' },
  { to: '/expenses', label: 'New expense' },
  { to: '/sales', label: 'New deal' },
  { to: '/crm', label: 'New customer' },
  { to: '/parts', label: 'Receive parts' },
]

export default function Layout() {
  const { state, setRole, markNotificationRead, updateSettings, apiMode, logout, lastError, clearError } = useStore()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [dark, setDark] = useState(state.settings.theme === 'dark')

  useEffect(() => {
    const isDark = state.settings.theme === 'dark'
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [state.settings.theme])

  // Mobile drawer: close on Escape, and lock body scroll while it is open.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [mobileOpen])
  const [showBell, setShowBell] = useState(false)
  const [showQuick, setShowQuick] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const unread = state.notifications.filter((n) => !n.read).length

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    updateSettings({ theme: next ? 'dark' : 'light' })
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-white dark:bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-4 dark:border-slate-800">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white">JX</span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-white">JX Car Dealer Tracker</p>
            <p className="text-xs text-slate-500">Dealership OS · <span className={`font-semibold ${apiMode ? 'text-emerald-600' : 'text-amber-600'}`}>{apiMode ? 'LIVE API' : 'DEMO DATA'}</span></p>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={() => setMobileOpen(false)}
            className={({ isActive }) => `mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'}`}>
            <Icon className="h-4.5 w-4.5 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
          <NavLink to="/ai-assistant" className="mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900">
            <Sparkles className="h-4.5 w-4.5 shrink-0" />{!collapsed && 'AI Voice-to-Work'}
          </NavLink>
          <NavLink to="/mcp" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900">
            <FileText className="h-4.5 w-4.5 shrink-0" />{!collapsed && 'MCP Integration'}
          </NavLink>
        </div>
      </nav>
      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <JXAvatar name={state.currentUser} size="sm" status="online" />
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{state.currentUser}</p>
              <p className="text-xs text-slate-500">{state.currentRole} · {state.settings.orgName}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-[#f8fafc] dark:bg-[#0b0f19]">
      {/* Desktop sidebar — off-canvas drawer below lg so tablets get the full width */}
      <aside className={`fixed inset-y-0 left-0 z-40 hidden border-r border-slate-200 transition-all lg:block dark:border-slate-800 ${collapsed ? 'w-16' : 'w-64'}`}>
        {sidebar}
      </aside>
      <button onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar"
        className="fixed bottom-4 left-4 z-40 hidden rounded-full border border-slate-200 bg-white p-2 shadow-md lg:block dark:border-slate-700 dark:bg-slate-900">
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72">
            {sidebar}
            <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="absolute right-3 top-4 rounded-lg bg-slate-100 p-1"><X className="h-5 w-5" /></button>
          </aside>
        </div>
      )}

      <div className={`flex min-w-0 flex-1 flex-col ${collapsed ? 'lg:pl-16' : 'lg:pl-64'}`}>
        <header className="sticky top-0 z-30 flex min-w-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 sm:px-5">
          <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <button className="rounded-lg p-2 hover:bg-slate-100 sm:hidden dark:hover:bg-slate-800" onClick={() => setShowMobileSearch((s) => !s)} aria-label="Search">
            <Search className="h-5 w-5" />
          </button>
          <form className="relative hidden min-w-0 flex-1 sm:block" onSubmit={(e) => { e.preventDefault(); if (query.trim()) navigate(`/inventory?q=${encodeURIComponent(query.trim())}`) }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search vehicles by VIN, stock no, make or model…"
              className="w-full max-w-md rounded-full border border-slate-300 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800" />
          </form>
          {showMobileSearch && (
            <form className="order-10 w-full sm:hidden" onSubmit={(e) => { e.preventDefault(); if (query.trim()) { navigate(`/inventory?q=${encodeURIComponent(query.trim())}`); setShowMobileSearch(false) } }}>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="Search vehicles by VIN, stock no, make or model…"
                  className="w-full rounded-full border border-slate-300 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-600 dark:border-slate-700 dark:bg-slate-800" />
              </div>
            </form>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative">
              <JXButton variant="outlined" size="sm" onClick={() => setShowQuick(!showQuick)}>
                <span className="inline-flex items-center gap-1"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Quick create</span></span>
              </JXButton>
              {showQuick && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {QUICK_CREATE.map((q) => (
                    <Link key={q.label} to={q.to} onClick={() => setShowQuick(false)} className="block px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">{q.label}</Link>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button onClick={() => setShowBell(!showBell)} aria-label="Notifications" className="relative rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unread}</span>}
              </button>
              {showBell && (
                <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {state.notifications.length === 0 && <p className="p-3 text-sm text-slate-500">No notifications.</p>}
                  {state.notifications.map((n) => (
                    <button key={n.id} onClick={() => markNotificationRead(n.id)} className="block w-full rounded-lg p-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
                      <p className={`text-sm font-semibold ${n.read ? 'text-slate-500' : 'text-slate-900 dark:text-white'}`}>{n.title}</p>
                      <p className="text-xs text-slate-500">{n.detail}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!apiMode ? (
              <div className="hidden w-44 lg:block">
                <JXSelect label="" options={ROLES.map((r) => ({ id: r, label: r }))} value={state.currentRole} onChange={(v) => setRole(v as typeof state.currentRole)} />
              </div>
            ) : (
              <button
                onClick={logout}
                aria-label="Sign out"
                title="Sign out"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            )}
            <button onClick={toggleTheme} aria-label="Toggle theme" className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
              <Moon className="h-5 w-5" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-3 py-5 sm:px-6">
          {lastError && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
              <div className="flex-1">
                <p className="font-semibold">Server request failed</p>
                <p className="text-xs">{lastError}</p>
              </div>
              <button onClick={clearError} aria-label="Dismiss error" className="rounded p-1 hover:bg-rose-100 dark:hover:bg-rose-900">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <Outlet />
        </main>
        <footer className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400 dark:border-slate-800">
          {apiMode
            ? `JX Car Dealer Tracker · Connected to API backend (${state.settings.orgName}).`
            : 'JX Car Dealer Tracker · DEMO environment — seed data is labelled demo and stored locally in your browser. No production backend is connected.'}
        </footer>
      </div>
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  return <>{children}</>
}
