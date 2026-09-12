import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, users } from "@/server/db/schema";
import { authenticateUser, createApiKey, createSessionRecord, createUser, resetUserPassword, revokeSession, validateApiKey, validateSessionToken } from "@/server/auth/core";
import { freshDb } from "../support/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => t.close());

describe("authentication", () => {
  it("creates users with hashed passwords and authenticates them", async () => {
    const u = await createUser(t.db, { organizationId: t.orgId, email: " Admin@Forge.Test ", name: "Admin", password: "correct-horse-battery", role: "admin" });
    expect(u.email).toBe("admin@forge.test");
    expect(u.passwordHash).not.toContain("correct-horse");
    expect((await authenticateUser(t.db, "admin@forge.test", "correct-horse-battery"))?.id).toBe(u.id);
    expect(await authenticateUser(t.db, "admin@forge.test", "wrong-password-123")).toBeNull();
    expect(await authenticateUser(t.db, "nobody@forge.test", "correct-horse-battery")).toBeNull();
    await expect(createUser(t.db, { organizationId: t.orgId, email: "admin@forge.test", name: "Dup", password: "correct-horse-battery", role: "viewer" })).rejects.toThrow(/already exists/);
  });

  it("issues opaque session tokens stored only as hashes, and revokes them", async () => {
    const [u] = await t.db.query.users.findMany({ limit: 1 });
    const { token } = await createSessionRecord(t.db, u.id, 14, { ip: "1.2.3.4" });
    const rows = await t.db.select().from(sessions);
    expect(rows.some((r) => r.id === token)).toBe(false); // raw token never stored
    expect((await validateSessionToken(t.db, token))?.user.email).toBe("admin@forge.test");
    await revokeSession(t.db, token);
    expect(await validateSessionToken(t.db, token)).toBeNull();
  });

  it("expires sessions", async () => {
    const [u] = await t.db.query.users.findMany({ limit: 1 });
    const { token } = await createSessionRecord(t.db, u.id, 14);
    await t.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await validateSessionToken(t.db, token)).toBeNull();
    expect(await t.db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
  });

  it("creates hashed API keys with a role", async () => {
    const { key } = await createApiKey(t.db, { organizationId: t.orgId, name: "ci", role: "viewer", createdBy: null });
    expect(key.startsWith("forge_")).toBe(true);
    expect((await validateApiKey(t.db, key))?.role).toBe("viewer");
    expect(await validateApiKey(t.db, key + "x")).toBeNull();
    expect(await validateApiKey(t.db, "not-a-key")).toBeNull();
  });
});

describe("account recovery", () => {
  it("resets the password, revokes every session and leaves the account state alone by default", async () => {
    const u = await createUser(t.db, { organizationId: t.orgId, email: "locked-out@forge.test", name: "Locked", password: "old-password-123", role: "admin" });
    const a = await createSessionRecord(t.db, u.id, 14);
    const b = await createSessionRecord(t.db, u.id, 14);
    const r = await resetUserPassword(t.db, { email: " Locked-Out@Forge.Test ", password: "new-password-456" });
    expect(r).toMatchObject({ id: u.id, email: "locked-out@forge.test", sessionsRevoked: 2, disabled: false });
    expect(r).not.toHaveProperty("passwordHash");
    expect(await authenticateUser(t.db, "locked-out@forge.test", "old-password-123")).toBeNull();
    expect((await authenticateUser(t.db, "locked-out@forge.test", "new-password-456"))?.id).toBe(u.id);
    expect(await validateSessionToken(t.db, a.token)).toBeNull();
    expect(await validateSessionToken(t.db, b.token)).toBeNull();
  });

  it("re-enables a disabled account only when asked", async () => {
    const u = await createUser(t.db, { organizationId: t.orgId, email: "disabled@forge.test", name: "Off", password: "old-password-123", role: "operator" });
    await t.db.update(users).set({ disabled: true }).where(eq(users.id, u.id));
    expect((await resetUserPassword(t.db, { email: "disabled@forge.test", password: "new-password-456" })).disabled).toBe(true);
    expect(await authenticateUser(t.db, "disabled@forge.test", "new-password-456")).toBeNull();
    expect((await resetUserPassword(t.db, { email: "disabled@forge.test", password: "new-password-789", enable: true })).disabled).toBe(false);
    expect((await authenticateUser(t.db, "disabled@forge.test", "new-password-789"))?.id).toBe(u.id);
  });

  it("rejects unknown accounts and short passwords without changing anything", async () => {
    await expect(resetUserPassword(t.db, { email: "nobody@forge.test", password: "new-password-456" })).rejects.toThrow(/not found/i);
    await expect(resetUserPassword(t.db, { email: "locked-out@forge.test", password: "short" })).rejects.toThrow(/at least 10/);
    expect((await authenticateUser(t.db, "locked-out@forge.test", "new-password-456"))).not.toBeNull();
  });
});
