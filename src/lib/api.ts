// Production API client for the JX Car Dealer Tracker.
// Wires the frontend to the backend in server/ (see docs/DEPLOYMENT.md).
// Demo mode: when VITE_API_URL is unset, API_MODE is false and this module
// is never used for data — the store keeps its localStorage demo behaviour.
// Auth endpoints live under /api/auth/*; resource endpoints under /api/*.
// Tokens are stored in localStorage under 'jx-dealer-token' /
// 'jx-dealer-refresh'. No credential value is ever logged or printed.
import type {
  Account, AppState, Customer, Deal, DocRecord, Expense, Lead, LeadStage,
  Part, Purchase, ReconJob, Settings, TeamMember, TransportOrder, Vehicle,
} from '../store/types'

export const API_MODE = Boolean(import.meta.env.VITE_API_URL)

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export const TOKEN_KEY = 'jx-dealer-token'
export const REFRESH_KEY = 'jx-dealer-refresh'

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function getRefreshToken(): string | null {
  try { return localStorage.getItem(REFRESH_KEY) } catch { return null }
}

export function setTokens(token: string, refreshToken: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(REFRESH_KEY, refreshToken)
  } catch { /* storage blocked */ }
}

export function clearTokens(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  } catch { /* storage blocked */ }
}

export function isAuthenticated(): boolean {
  return getToken() !== null
}

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string
}

export interface AuthResponse {
  token: string
  refreshToken: string
  user: AuthUser
  organization: { id: string; name: string }
}

export interface MeResponse {
  user: AuthUser
  organization: { id: string; name: string }
  memberships: { organizationId: string; organizationName: string; role: string }[]
}

/** Full server snapshot: the AppState shape plus the organization it belongs to. */
export type ApiState = AppState & {
  organization: { id: string; name: string }
}

interface ErrorBody {
  error?: string | { message?: string; code?: string }
  message?: string
}

async function parseBody<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!text) return {} as T
  try { return JSON.parse(text) as T } catch { return {} as T }
}

async function throwForStatus(res: Response): Promise<never> {
  const body = await parseBody<ErrorBody>(res).catch(() => ({} as ErrorBody))
  const errField = body.error
  const message =
    (typeof errField === 'string' ? errField : errField?.message) ||
    body.message ||
    `Request failed (${res.status})`
  throw new Error(message)
}

/** Raw request: JSON in, JSON out, no auth handling. */
async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) await throwForStatus(res)
  return parseBody<T>(res)
}

/**
 * Authenticated request. Attaches `Authorization: Bearer <accessJwt>` and,
 * on a 401, refreshes the token once via POST /auth/refresh and retries.
 * Throws an Error carrying the server's `{error}` message.
 */
async function apiFetch<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 401 && !retried) {
    const refreshToken = getRefreshToken()
    if (refreshToken) {
      try {
        const refreshed = await request<AuthResponse>('/api/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        })
        setTokens(refreshed.token, refreshed.refreshToken)
        return apiFetch<T>(path, init, true)
      } catch {
        // Refresh token is invalid/expired — force a fresh sign-in.
        clearTokens()
        throw new Error('Session expired — please sign in again.')
      }
    }
    clearTokens()
    throw new Error('Session expired — please sign in again.')
  }
  if (!res.ok) await throwForStatus(res)
  return parseBody<T>(res)
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
const patch = <T>(path: string, body: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) })

// ---- Auth -----------------------------------------------------------------

export async function login(email: string, password: string, organizationId?: string): Promise<AuthResponse> {
  const res = await request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(organizationId ? { organizationId } : {}) }),
  })
  setTokens(res.token, res.refreshToken)
  return res
}

export async function register(orgName: string, name: string, email: string, password: string): Promise<AuthResponse> {
  const res = await request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ orgName, name, email, password }),
  })
  setTokens(res.token, res.refreshToken)
  return res
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken()
  try {
    if (refreshToken) {
      await request('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) })
    }
  } catch { /* logout is best-effort — tokens are cleared below regardless */ }
  clearTokens()
}

export function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/api/auth/me')
}

// ---- State ------------------------------------------------------------------

export function getState(): Promise<ApiState> {
  return apiFetch<ApiState>('/api/state')
}

// ---- Mutations (one per endpoint; names match the store actions) -----------

export function addVehicle(v: Omit<Vehicle, 'id' | 'createdAt'>): Promise<Vehicle> {
  return post<Vehicle>('/api/vehicles', v)
}

export function recordPurchase(
  p: Omit<Purchase, 'id' | 'ref' | 'createdAt' | 'vehicleId'>,
  vehicle: Omit<Vehicle, 'id' | 'createdAt'>,
): Promise<Purchase> {
  return post<Purchase>('/api/purchases', { ...p, vehicle })
}

export function updateVehicleStatus(vehicleId: string, status: Vehicle['status']): Promise<Vehicle> {
  return patch<Vehicle>(`/api/vehicles/${vehicleId}`, { status })
}

export function addTransport(t: Omit<TransportOrder, 'id'>): Promise<TransportOrder> {
  return post<TransportOrder>('/api/transport', t)
}

export function updateTransport(id: string, patchBody: Partial<TransportOrder>): Promise<TransportOrder> {
  return patch<TransportOrder>(`/api/transport/${id}`, patchBody)
}

export function recordExpense(e: Omit<Expense, 'id'>): Promise<Expense> {
  return post<Expense>('/api/expenses', e)
}

export function addReconJob(j: Omit<ReconJob, 'id'>): Promise<ReconJob> {
  return post<ReconJob>('/api/recon', j)
}

export function updateReconJob(id: string, patchBody: Partial<ReconJob>): Promise<ReconJob> {
  return patch<ReconJob>(`/api/recon/${id}`, patchBody)
}

export function addPart(part: Omit<Part, 'id'>): Promise<Part> {
  return post<Part>('/api/parts', part)
}

export function receivePartBatch(
  partId: string, qty: number, unitPrice: number, invoice: string,
): Promise<{ id: string }> {
  return post<{ id: string }>(`/api/parts/${partId}/batches`, { qty, unitPrice, invoice })
}

export function allocatePart(
  partId: string, vehicleId: string, qty: number,
): Promise<{ id: string; fifoCost?: number }> {
  return post<{ id: string; fifoCost?: number }>(`/api/parts/${partId}/allocate`, { vehicleId, qty })
}

export function addCustomer(c: Omit<Customer, 'id'>): Promise<Customer> {
  return post<Customer>('/api/customers', c)
}

export function addInteraction(
  customerId: string, type: 'Call' | 'Email' | 'WhatsApp' | 'Visit' | 'Test drive', notes: string,
): Promise<{ id: string }> {
  const date = new Date().toISOString().slice(0, 10)
  return post<{ id: string }>(`/api/customers/${customerId}/interactions`, { type, notes, date })
}

export function addLead(l: Omit<Lead, 'id' | 'createdAt'>): Promise<Lead> {
  return post<Lead>('/api/leads', l)
}

export function moveLead(leadId: string, stage: LeadStage): Promise<Lead> {
  return patch<Lead>(`/api/leads/${leadId}`, { stage })
}

export function addOffer(vehicleId: string, customerId: string, amount: number): Promise<{ id: string }> {
  const date = new Date().toISOString().slice(0, 10)
  return post<{ id: string }>('/api/offers', { vehicleId, customerId, amount, date })
}

export function createDeal(
  d: Omit<Deal, 'id' | 'ref' | 'status' | 'createdAt' | 'finalizedAt' | 'saleRef'>,
): Promise<Deal> {
  return post<Deal>('/api/deals', d)
}

export function finalizeSale(dealId: string): Promise<{ saleRef?: string; id?: string }> {
  return post<{ saleRef?: string; id?: string }>(`/api/deals/${dealId}/finalize`, {})
}

export function recordPayment(
  receivableId: string, amount: number, accountId: string,
): Promise<{ id: string }> {
  return post<{ id: string }>(`/api/receivables/${receivableId}/payments`, { amount, accountId })
}

export function transfer(
  fromAccountId: string, toAccountId: string, amount: number, note: string,
): Promise<{ id?: string }> {
  return post<{ id?: string }>('/api/transactions/transfer', { fromAccountId, toAccountId, amount, note })
}

export function addDocument(d: Omit<DocRecord, 'id' | 'uploadedAt' | 'uploadedBy'>): Promise<DocRecord> {
  return post<DocRecord>('/api/documents', d)
}

export function addTeamMember(m: Omit<TeamMember, 'id'>): Promise<TeamMember> {
  return post<TeamMember>('/api/team', m)
}

export function setMemberActive(id: string, active: boolean): Promise<TeamMember> {
  return patch<TeamMember>(`/api/team/${id}`, { active })
}

export function markNotificationRead(id: string): Promise<{ id: string }> {
  return patch<{ id: string }>(`/api/notifications/${id}`, { read: true })
}

export function updateSettings(patchBody: Partial<Settings>): Promise<Settings> {
  return patch<Settings>('/api/settings', patchBody)
}

export function addAccount(account: Omit<Account, 'id'>): Promise<Account> {
  return post<Account>('/api/accounts', account)
}

export interface AiOperationDto {
  id: string
  command: string
  parsedKind: string
  parsedPayload: Record<string, unknown>
  status: string
  summary: string
  sensitive: boolean
}

export function proposeAiOperation(
  command: string,
): Promise<{ operation: AiOperationDto; result?: Record<string, unknown> }> {
  return post<{ operation: AiOperationDto; result?: Record<string, unknown> }>('/api/ai/operations', { command })
}

export function confirmAiOperation(
  id: string,
  body: { confirm: boolean; vin?: string; stockNumber?: string; askingPrice?: number },
): Promise<{ operation: AiOperationDto }> {
  return post<{ operation: AiOperationDto }>(`/api/ai/operations/${id}/confirm`, body)
}
