import { createDb, setDbForTesting, type Database } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { systemContext, userContext, type ServiceContext } from "@/server/context";
import { ensureDefaultOrganization } from "@/server/services/org";
import { resetEnvCache } from "@/server/env";

/** Fresh in-memory PostgreSQL (PGlite) with all migrations applied. */
export async function freshDb(): Promise<{ db: Database; orgId: string; ctx: ServiceContext; close: () => Promise<void> }> {
  resetEnvCache();
  const handle = createDb("pglite://memory");
  setDbForTesting(handle);
  await runMigrations(handle.db, "pglite");
  const org = await ensureDefaultOrganization(handle.db);
  return { db: handle.db, orgId: org.id, ctx: systemContext(org.id, handle.db), close: handle.close };
}

export function asRole(ctx: ServiceContext, role: "admin" | "operator" | "viewer"): ServiceContext {
  return userContext({ orgId: ctx.orgId, userId: "00000000-0000-0000-0000-000000000001", role, db: ctx.db });
}

export const sampleProduct = (over: Record<string, unknown> = {}) => ({
  title: "Magnetic Cable Organizer (6 Clips)",
  description: "Adhesive clips with magnetic holders that keep charging cables in place.",
  businessModel: "DROPSHIPPING",
  currency: "USD",
  sellingPrice: 12.99,
  cost: 2.1,
  shippingCost: 1.8,
  shippingDaysMin: 6,
  shippingDaysMax: 10,
  problemSolved: "charging cables falling behind the desk",
  targetAudience: "people who work from a desk",
  highlights: ["Magnetic holders — cables click in and stay", "Strong adhesive base"],
  tags: ["desk setup"],
  trendScore: 66,
  competitionScore: 58,
  contentScore: 80,
  impulseScore: 90,
  problemScore: 78,
  noveltyScore: 62,
  productUrl: "https://example.com/store/cable-clips",
  ...over,
});
