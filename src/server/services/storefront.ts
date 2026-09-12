// Public (storefront) read model. Only products in public statuses; demo rows only in DEMO_MODE.

import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { and, asc, desc, eq, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { PUBLIC_PRODUCT_STATUSES } from "@/lib/constants";
import { getDb } from "../db/client";
import { affiliateLinks, affiliateProducts, articles, categories, productReviews, productSignals, products, type Product } from "../db/schema";
import { getAffiliateProvider } from "../affiliate/registry";
import { isDemoMode } from "../env";
import { getSetting } from "../settings";
import { visibleOnStorefront } from "./affiliate-publishing";
import { resolveStorefront } from "./org";
import { latestScore } from "./scoring";

export const storefront = cache(async () => {
  const host = (await headers()).get("host");
  const db = getDb();
  const { org, store } = await resolveStorefront(db, host);
  const [currency, settings] = await Promise.all([getSetting({ db, orgId: org.id }, "currency"), getSetting({ db, orgId: org.id }, "storefront")]);
  return { db, org, store, rates: currency.rates, settings };
});

export type PublicProduct = Product & { categoryName: string | null; categorySlug: string | null; categoryIcon: string | null };

type Sort = "score" | "trend" | "problem" | "content" | "recent" | "price";

export async function publicProducts(opts: { sort?: Sort; maxPrice?: number; categoryId?: string; limit?: number; excludeIds?: string[]; statuses?: string[] } = {}): Promise<PublicProduct[]> {
  const { db, org } = await storefront();
  const conds: Array<SQL | undefined> = [eq(products.organizationId, org.id), inArray(products.status, (opts.statuses ?? PUBLIC_PRODUCT_STATUSES) as Product["status"][]), eq(products.available, true), visibleOnStorefront()];
  if (!isDemoMode()) conds.push(eq(products.isDemo, false));
  if (opts.maxPrice !== undefined) conds.push(lte(products.sellingPrice, opts.maxPrice));
  if (opts.categoryId) conds.push(eq(products.categoryId, opts.categoryId));
  if (opts.excludeIds?.length) for (const id of opts.excludeIds) conds.push(ne(products.id, id));
  const order = {
    score: [desc(sql`coalesce(${products.overallScore}, 0)`)],
    trend: [desc(sql`coalesce(${products.trendScore}, 0)`)],
    problem: [desc(sql`coalesce(${products.problemScore}, 0)`)],
    content: [desc(sql`coalesce(${products.contentScore}, 0)`)],
    recent: [desc(products.discoveredAt)],
    price: [asc(products.sellingPrice)],
  }[opts.sort ?? "score"];
  const rows = await db
    .select({ p: products, categoryName: categories.name, categorySlug: categories.slug, categoryIcon: categories.icon })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...conds))
    .orderBy(...order, asc(products.title))
    .limit(opts.limit ?? 24);
  return rows.map((r) => ({ ...r.p, categoryName: r.categoryName, categorySlug: r.categorySlug, categoryIcon: r.categoryIcon }));
}

export async function publicProductBySlug(slug: string) {
  const { db, org } = await storefront();
  const [row] = await db
    .select({ p: products, categoryName: categories.name, categorySlug: categories.slug, categoryIcon: categories.icon })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.organizationId, org.id), eq(products.slug, slug), inArray(products.status, PUBLIC_PRODUCT_STATUSES as Product["status"][]), visibleOnStorefront()))
    .limit(1);
  if (!row || (row.p.isDemo && !isDemoMode())) return null;
  const product: PublicProduct = { ...row.p, categoryName: row.categoryName, categorySlug: row.categorySlug, categoryIcon: row.categoryIcon };
  const [score, link, reviews, signals, listing] = await Promise.all([
    latestScore({ db }, product.id),
    db.select().from(affiliateLinks).where(eq(affiliateLinks.productId, product.id)).orderBy(desc(affiliateLinks.isPrimary), desc(affiliateLinks.createdAt)).limit(1),
    db.select().from(productReviews).where(eq(productReviews.productId, product.id)).orderBy(desc(productReviews.reviewedAt)).limit(6),
    db.select().from(productSignals).where(eq(productSignals.productId, product.id)).orderBy(desc(productSignals.observedAt)).limit(6),
    db.select({ network: affiliateProducts.network, marketplace: affiliateProducts.marketplace }).from(affiliateProducts).where(and(eq(affiliateProducts.productId, product.id), eq(affiliateProducts.status, "PUBLISHED"))).limit(1),
  ]);
  // Products published from a network listing follow that network's display rules (price timestamp, disclosure…).
  const provider = listing[0] ? getAffiliateProvider(listing[0].network) : null;
  const network = listing[0] ? { network: listing[0].network, marketplace: listing[0].marketplace, policy: provider?.storefrontPolicy(listing[0].marketplace) ?? null } : null;
  return { product, score, link: link[0] ?? null, reviews, signals, network };
}

export async function publicCategories() {
  const { db, org } = await storefront();
  const rows = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug, icon: categories.icon, description: categories.description, n: sql<number>`count(${products.id})::int` })
    .from(categories)
    .innerJoin(products, and(eq(products.categoryId, categories.id), inArray(products.status, PUBLIC_PRODUCT_STATUSES as Product["status"][]), visibleOnStorefront(), isDemoMode() ? undefined : eq(products.isDemo, false)))
    .where(eq(categories.organizationId, org.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.name));
  return rows;
}

export async function publicCategoryBySlug(slug: string) {
  const { db, org } = await storefront();
  const [row] = await db.select().from(categories).where(and(eq(categories.organizationId, org.id), eq(categories.slug, slug))).limit(1);
  return row ?? null;
}

export async function publishedArticles(limit = 20) {
  const { db, org } = await storefront();
  return db
    .select()
    .from(articles)
    .where(and(eq(articles.organizationId, org.id), eq(articles.status, "PUBLISHED"), isDemoMode() ? undefined : eq(articles.isDemo, false)))
    .orderBy(desc(articles.publishedAt))
    .limit(limit);
}

export async function productsByIds(ids: string[]) {
  if (!ids.length) return [];
  const { db } = await storefront();
  const rows = await db
    .select({ p: products, categoryName: categories.name, categorySlug: categories.slug, categoryIcon: categories.icon })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(inArray(products.id, ids), inArray(products.status, PUBLIC_PRODUCT_STATUSES as Product["status"][]), visibleOnStorefront()));
  return rows.map((r) => ({ ...r.p, categoryName: r.categoryName, categorySlug: r.categorySlug, categoryIcon: r.categoryIcon }));
}
