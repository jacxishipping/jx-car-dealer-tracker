// Role → permission matrix + requirePermission middleware.
// Roles: Owner / Admin / Manager / Sales / Accountant / Technician / Viewer.
// Viewer is read-only (no write permissions). Technician does recon + vehicle
// status only. Sales does customers/leads/deals/sales. Accountant does
// finance/expenses/reports. Manager does all operational work except
// team.manage and settings.write. Admin does everything except managing the
// Owner role (enforced in the team routes). Owner does everything.
import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../lib/errors';
import type { Role } from '../lib/types';

export type Permission =
  | 'vehicle.create'
  | 'vehicle.update'
  | 'purchase.create'
  | 'expense.create'
  | 'expense.pay'
  | 'part.allocate'
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
  | 'ai.execute';

export const ALL_PERMISSIONS: Permission[] = [
  'vehicle.create', 'vehicle.update', 'purchase.create', 'expense.create', 'expense.pay',
  'part.allocate', 'customer.create', 'lead.create', 'deal.create', 'sale.finalize',
  'payment.record', 'finance.read', 'finance.write', 'team.manage', 'settings.write',
  'mcp.read', 'mcp.write', 'ai.execute',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  Owner: [...ALL_PERMISSIONS],
  Admin: [...ALL_PERMISSIONS],
  Manager: ALL_PERMISSIONS.filter((p) => p !== 'team.manage' && p !== 'settings.write'),
  Sales: ['customer.create', 'lead.create', 'deal.create', 'sale.finalize', 'mcp.read', 'mcp.write'],
  Accountant: [
    'expense.create', 'expense.pay', 'payment.record',
    'finance.read', 'finance.write', 'mcp.read', 'mcp.write',
  ],
  Technician: ['vehicle.update', 'part.allocate', 'mcp.read'],
  Viewer: ['mcp.read'],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

/**
 * Passes when the caller's role holds ANY of the listed permissions.
 * The auth middleware must run first (req.role is set there).
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = req.role;
    if (!role) return next(forbidden('Authentication required'));
    if (permissions.some((p) => roleHasPermission(role, p))) return next();
    return next(forbidden(`Role ${role} cannot perform this action`));
  };
}

/** Passes when the caller's role is one of the listed roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.role && roles.includes(req.role)) return next();
    return next(forbidden(`This action requires one of: ${roles.join(', ')}`));
  };
}

/**
 * Only the Owner may assign/remove the Owner role; Admin may manage every
 * other role. Returns false for everyone else.
 */
export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === 'Owner') return true;
  if (actorRole === 'Admin') return targetRole !== 'Owner';
  return false;
}
