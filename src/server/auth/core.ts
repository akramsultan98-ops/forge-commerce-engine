// Framework-agnostic authentication core (sessions, credentials, API keys). The Next.js cookie
// glue lives in ./session.ts; keeping this layer free of next/* makes it unit-testable.

import { and, eq, isNull } from "drizzle-orm";
import type { UserRole } from "@/lib/constants";
import type { Database } from "../db/client";
import { apiKeys, sessions, users, type User } from "../db/schema";
import { randomToken, sha256Hex } from "../security/crypto";
import { dummyVerify, hashPassword, verifyPassword } from "./password";
import { ConflictError, ValidationError } from "../errors";

export const SESSION_SLIDE_MS = 60 * 60_000;

export async function createSessionRecord(db: Database, userId: string, ttlDays: number, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + ttlDays * 86400_000);
  await db.insert(sessions).values({
    id: sha256Hex(token),
    userId,
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  return { token, expiresAt };
}

export type SessionUser = Pick<User, "id" | "organizationId" | "email" | "name" | "role" | "locale">;

export async function validateSessionToken(db: Database, token: string, ttlDays = 14): Promise<{ user: SessionUser; sessionId: string; expiresAt: Date } | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const id = sha256Hex(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      user: { id: users.id, organizationId: users.organizationId, email: users.email, name: users.name, role: users.role, locale: users.locale, disabled: users.disabled },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now || row.user.disabled) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (now - row.lastSeenAt.getTime() > SESSION_SLIDE_MS) {
    // Sliding expiration: active sessions stay alive; idle ones expire.
    const expiresAt = new Date(now + ttlDays * 86400_000);
    await db.update(sessions).set({ lastSeenAt: new Date(now), expiresAt }).where(eq(sessions.id, id));
    row.expiresAt = expiresAt;
  }
  const { disabled: _disabled, ...user } = row.user;
  return { user, sessionId: row.sessionId, expiresAt: row.expiresAt };
}

export async function revokeSession(db: Database, token: string) {
  await db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
}

export async function revokeUserSessions(db: Database, userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Returns the user on success, null on any failure (constant-ish time; no user enumeration). */
export async function authenticateUser(db: Database, email: string, password: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
  if (!user) {
    await dummyVerify();
    return null;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok || user.disabled) return null;
  return user;
}

export async function createUser(db: Database, input: { organizationId: string; email: string; name: string; password: string; role: UserRole; locale?: string }) {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Invalid email address");
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new ConflictError("A user with that email already exists");
  const [user] = await db
    .insert(users)
    .values({ organizationId: input.organizationId, email, name: input.name.trim().slice(0, 120), passwordHash: await hashPassword(input.password), role: input.role, locale: input.locale ?? "en" })
    .returning();
  return user;
}

export async function countUsers(db: Database): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length;
}

// ── API keys (for integrations and scripts). Format: forge_<8-char prefix>_<secret> ──
export async function createApiKey(db: Database, input: { organizationId: string; name: string; role: UserRole; createdBy: string | null }) {
  const prefix = randomToken(6).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).padEnd(8, "x");
  const secret = randomToken(32);
  const key = `forge_${prefix}_${secret}`;
  const [row] = await db
    .insert(apiKeys)
    .values({ organizationId: input.organizationId, name: input.name.slice(0, 80), keyPrefix: prefix, keyHash: sha256Hex(key), role: input.role, createdBy: input.createdBy })
    .returning({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, role: apiKeys.role, createdAt: apiKeys.createdAt });
  return { key, record: row };
}

export async function validateApiKey(db: Database, raw: string): Promise<{ orgId: string; role: UserRole; keyId: string } | null> {
  if (!/^forge_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{20,}$/.test(raw)) return null;
  const [row] = await db
    .select({ id: apiKeys.id, orgId: apiKeys.organizationId, role: apiKeys.role })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, sha256Hex(raw)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return { orgId: row.orgId, role: row.role, keyId: row.id };
}
