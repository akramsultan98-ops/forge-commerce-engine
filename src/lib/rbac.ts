// Role-based access control. Client-safe so the UI can hide actions a role cannot perform;
// the server enforces the same table on every mutation.

import type { UserRole } from "./constants";

const ALL: UserRole[] = ["admin", "operator", "viewer"];
const OPS: UserRole[] = ["admin", "operator"];
const ADMIN: UserRole[] = ["admin"];

export const PERMISSIONS = {
  "dashboard:read": ALL,
  "products:read": ALL,
  "products:write": OPS,
  "products:delete": ADMIN,
  "research:run": OPS,
  "agents:run": OPS,
  "content:read": ALL,
  "content:write": OPS,
  "content:publish": OPS,
  "campaigns:write": OPS,
  "landing:write": OPS,
  "affiliate:read": ALL,
  "affiliate:write": OPS,
  "analytics:read": ALL,
  "experiments:write": OPS,
  "reports:read": ALL,
  "jobs:run": OPS,
  "logs:read": OPS,
  "settings:read": OPS,
  "settings:write": ADMIN,
  "integrations:manage": ADMIN,
  "users:manage": ADMIN,
  "apikeys:manage": ADMIN,
} as const satisfies Record<string, UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

export const ROLE_RANK: Record<UserRole, number> = { viewer: 0, operator: 1, admin: 2 };

export function atLeast(role: UserRole, min: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
