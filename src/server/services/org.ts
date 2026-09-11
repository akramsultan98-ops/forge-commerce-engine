import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { organizations, stores, type Organization, type Store } from "../db/schema";
import { env } from "../env";

/** Returns the first organization, creating "FORGE" + a default storefront store on first boot. */
export async function ensureDefaultOrganization(db: Database): Promise<Organization> {
  const [existing] = await db.select().from(organizations).orderBy(asc(organizations.createdAt)).limit(1);
  if (existing) return existing;
  const e = env();
  const [org] = await db
    .insert(organizations)
    .values({ name: "FORGE", slug: "forge", defaultCurrency: e.DEFAULT_CURRENCY, defaultMarket: e.DEFAULT_MARKET, defaultLocale: e.DEFAULT_LOCALE })
    .onConflictDoNothing()
    .returning();
  const created = org ?? (await db.select().from(organizations).where(eq(organizations.slug, "forge")).limit(1))[0];
  await db
    .insert(stores)
    .values({ organizationId: created.id, name: "FORGE Storefront", slug: "main", type: "STOREFRONT", currency: e.DEFAULT_CURRENCY, locale: e.DEFAULT_LOCALE, market: e.DEFAULT_MARKET, isDefault: true })
    .onConflictDoNothing();
  return created;
}

export async function getDefaultStore(db: Database, orgId: string): Promise<Store | null> {
  const rows = await db.select().from(stores).where(eq(stores.organizationId, orgId)).orderBy(asc(stores.createdAt));
  return rows.find((s) => s.isDefault) ?? rows[0] ?? null;
}

/**
 * Resolves which organization + store the public storefront serves. A store whose `domain`
 * matches the request host wins; otherwise the default organization's default store.
 */
export async function resolveStorefront(db: Database, host?: string | null): Promise<{ org: Organization; store: Store | null }> {
  if (host) {
    const hostname = host.split(":")[0].toLowerCase();
    const [match] = await db.select().from(stores).where(eq(stores.domain, hostname)).limit(1);
    if (match) {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, match.organizationId)).limit(1);
      if (org) return { org, store: match };
    }
  }
  const org = await ensureDefaultOrganization(db);
  return { org, store: await getDefaultStore(db, org.id) };
}
