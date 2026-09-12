// Role-based access control. Client-safe so the UI can hide actions a role cannot perform;
// the server enforces the same table on every mutation.

import type { UserRole } from "./constants";

const ALL: UserRole[] = ["admin", "operator", "viewer"];
const OPS: UserRole[] = ["admin", "operator"];
const ADMIN: UserRole[] = ["admin"];
// The automation role (API keys for n8n) only reaches the affiliate listing pipeline.
const ALL_AND_MACHINES: UserRole[] = [...ALL, "automation"];
const OPS_AND_MACHINES: UserRole[] = [...OPS, "automation"];

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
  "affiliate:read": ALL_AND_MACHINES,
  "affiliate:write": OPS,
  // Network listings: machines prepare (discover, ingest, refresh, score, submit, report failures)…
  "affiliate:ingest": OPS_AND_MACHINES,
  // …people decide (approve, reject, publish, restore, edit FORGE-owned fields). Approve and publish
  // additionally require a signed-in person — see HUMAN_ONLY_ACTIONS.
  "affiliate:review": OPS,
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

export const ROLE_RANK: Record<UserRole, number> = { automation: 0, viewer: 0, operator: 1, admin: 2 };

export function atLeast(role: UserRole, min: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
