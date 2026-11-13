// Login / register screen — shown only in API mode (VITE_API_URL is set)
// when there is no token. In demo mode this screen is never rendered.
// On success the tokens are stored by api.login / api.register and the
// page reloads so App renders the app shell with an authenticated store.
import { useState, type FormEvent } from 'react'
import { JXButton, JXCard } from '@jacxishippingorg/jx-ui-react'
import { AppTextField as JXTextField } from "./AppTextField"
import { Car, Eye, EyeOff } from 'lucide-react'
import * as api from '../lib/api'
import { Alert, Field, inputCls } from './ui'

export default function LoginScreen({ onAuthenticated }: { onAuthenticated?: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [orgName, setOrgName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    if (mode === 'register' && (!orgName.trim() || !name.trim())) {
      setError('Enter your organization name and your name.')
      return
    }
    if (mode === 'register' && password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      if (mode === 'register') {
        await api.register(orgName.trim(), name.trim(), email.trim(), password)
      } else {
        await api.login(email.trim(), password)
      }
      if (onAuthenticated) {
        onAuthenticated()
      } else {
        window.location.reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-4 py-10 dark:bg-[#0b0f19]">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
            <Car className="h-6 w-6" />
          </span>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">JX Car Dealer Tracker</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {mode === 'login' ? 'Sign in to your dealership workspace.' : 'Create your dealership workspace.'}
          </p>
        </div>

        <JXCard className="overflow-hidden !rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="p-5 sm:p-6">
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => { setMode('login'); setError('') }}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => { setMode('register'); setError('') }}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                Create organization
              </button>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
              {mode === 'register' && (
                <>
                  <Field label="Organization name">
                    <input className={inputCls} value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="JX Auto Sales" autoComplete="organization" disabled={loading} />
                  </Field>
                  <Field label="Your name">
                    <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Morgan" autoComplete="name" disabled={loading} />
                  </Field>
                </>
              )}
              <Field label="Email">
                <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dealership.com" autoComplete="email" disabled={loading} />
              </Field>
                <Field label="Password" htmlFor="login-password" hint={mode === 'register' ? 'Minimum 8 characters' : undefined}>
                  <div className="relative">
                    <JXTextField
                      id="login-password"
                      className="jx-text-field login-password-field"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={setPassword}
                      placeholder="••••••••"
                      autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                      disabled={loading}
                      label=""
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-0 top-1/2 inline-flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-[var(--radius-control)] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      disabled={loading}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>

                {error && <Alert severity="error" title="Could not sign in" description={error} />}

                <JXButton variant="contained" size="md" type="submit" disabled={loading} loading={loading} fullWidth>
                  {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create organization & sign in'}
                </JXButton>
            </form>

              <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
                {mode === 'login'
                  ? 'Your data lives in your organization on the dealer API — not in this browser.'
                  : 'The first account becomes the organization owner. You can invite your team afterwards.'}
              </p>
          </div>
        </JXCard>
      </div>
    </div>
  )
}
