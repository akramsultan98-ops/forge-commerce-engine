import type { MetadataRoute } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { PUBLIC_PRODUCT_STATUSES } from "@/lib/constants";
import { getDb } from "@/server/db/client";
import { articles, categories, products, type Product } from "@/server/db/schema";
import { env, isDemoMode } from "@/server/env";
import { ensureDefaultOrganization } from "@/server/services/org";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env().APP_URL.replace(/\/$/, "");
  const db = getDb();
  const org = await ensureDefaultOrganization(db);
  const demo = isDemoMode();
  const [prods, cats, arts] = await Promise.all([
    db.select({ slug: products.slug, updatedAt: products.updatedAt }).from(products).where(and(eq(products.organizationId, org.id), inArray(products.status, PUBLIC_PRODUCT_STATUSES as Product["status"][]), demo ? undefined : eq(products.isDemo, false))),
    db.select({ slug: categories.slug }).from(categories).where(eq(categories.organizationId, org.id)),
    db.select({ slug: articles.slug, updatedAt: articles.updatedAt }).from(articles).where(and(eq(articles.organizationId, org.id), eq(articles.status, "PUBLISHED"), demo ? undefined : eq(articles.isDemo, false))),
  ]);
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    ...["/products", "/trending", "/best-products", "/guides"].map((p) => ({ url: `${base}${p}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.8 })),
    ...prods.map((p) => ({ url: `${base}/products/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...cats.map((c) => ({ url: `${base}/category/${c.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.6 })),
    ...arts.map((a) => ({ url: `${base}/guides/${a.slug}`, lastModified: a.updatedAt, changeFrequency: "monthly" as const, priority: 0.6 })),
    ...["privacy", "terms", "cookies", "returns", "affiliate-disclosure"].map((d) => ({ url: `${base}/legal/${d}`, lastModified: now, changeFrequency: "yearly" as const, priority: 0.2 })),
  ];
}
