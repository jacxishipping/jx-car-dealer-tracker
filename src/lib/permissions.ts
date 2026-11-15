import type { Role } from '../store/types'

/** Mirrors server/src/middleware/rbac.ts, plus a few UI-only aliases for client gating. */
export type Permission =
  | 'vehicle.create'
  | 'vehicle.update'
  | 'purchase.create'
  | 'expense.create'
  | 'expense.pay'
  | 'part.allocate'
  | 'parts.write'
  | 'transport.create'
  | 'customer.create'
  | 'lead.create'
  | 'deal.create'
  | 'sale.finalize'
  | 'payment.record'
  | 'finance.read'
  | 'finance.write'
  | 'team.manage'
  | 'settings.write'
  | 'mcp.read'
  | 'mcp.write'
  | 'ai.execute'
  | 'recon.write'
  | 'document.write'

const ALL: Permission[] = [
  'vehicle.create', 'vehicle.update', 'purchase.create', 'expense.create', 'expense.pay',
  'part.allocate', 'parts.write', 'transport.create', 'customer.create', 'lead.create',
  'deal.create', 'sale.finalize', 'payment.record', 'finance.read', 'finance.write',
  'team.manage', 'settings.write', 'mcp.read', 'mcp.write', 'ai.execute', 'recon.write', 'document.write',
]

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  Owner: [...ALL],
  Admin: [...ALL],
  Manager: ALL.filter((p) => p !== 'team.manage' && p !== 'settings.write'),
  Sales: ['customer.create', 'lead.create', 'deal.create', 'sale.finalize', 'mcp.read', 'mcp.write', 'document.write'],
  Accountant: [
    'expense.create', 'expense.pay', 'payment.record',
    'finance.read', 'finance.write', 'mcp.read', 'mcp.write', 'document.write',
  ],
  Technician: ['vehicle.update', 'part.allocate', 'parts.write', 'recon.write', 'mcp.read'],
  Viewer: ['mcp.read', 'finance.read'],
}

export function can(role: Role, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission)
}

export function canAny(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p))
}
