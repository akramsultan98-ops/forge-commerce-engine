// Storefront publishing for network listings. Publishing an APPROVED affiliate_product creates (or
// refreshes) a FORGE storefront product with one tracked link. The listing stays the source of truth:
// network-supplied product fields are copied from it on publish and on every refresh (never edited on
// the product), and the product carries the data's expiry so the storefront stops showing network data
// once it is too old to show. Network-specific rules come from the provider's storefront policy.

import { and, eq, gt, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { PUBLIC_PRODUCT_STATUSES, type Provenance } from "@/lib/constants";
import { slugify } from "@/lib/utils";
import { dataExpiresAt } from "@/domain/affiliate-products";
import type { ServiceContext } from "../context";
import { affiliateLinks, affiliateProducts, categories, productTests, products, type AffiliateLink, type AffiliateProduct, type FieldProvenance, type NewProduct, type Product } from "../db/schema";
import { getAffiliateProvider } from "../affiliate/registry";
import { newLinkCode } from "./affiliate";
import { uniqueSlug } from "./products";

/** Storefront condition: products backed by network data are shown only until that data expires (database clock). */
export function visibleOnStorefront(): SQL {
  return or(isNull(products.externalDataExpiresAt), gt(products.externalDataExpiresAt, sql`now()`))!;
}

/** Stable storefront identity of a listing (products.source_product_id) — unique per network, marketplace and id. */
export const listingSourceId = (l: Pick<AffiliateProduct, "network" | "marketplace" | "externalId">) => `${l.network}:${l.marketplace}:${l.externalId}`;

/** Provenance-tracked product fields that a listing supplies; their old entries are replaced on every sync. */
const LISTING_TRACKED_FIELDS = ["sellingPrice", "rating", "reviewCount", "countriesAvailable", "commissionPercentage"] as const;

/**
 * The storefront product values a listing produces: the network's facts plus the listing's
 * FORGE-owned editorial fields. Pure — no database access. Images stay links (never copied).
 */
export function productFieldsFromListing(l: AffiliateProduct): { values: Partial<NewProduct>; provenance: Record<string, FieldProvenance> } {
  const provider = getAffiliateProvider(l.network);
  const policy = provider?.storefrontPolicy(l.marketplace) ?? null;
  const priced = l.price !== null && !!l.currency;
  const rated = !!l.reviewSource;
  const commission = l.commissionRate ?? l.expectedCommissionRate ?? null;
  const at = (l.dataFetchedAt ?? new Date()).toISOString();
  const source = `${l.network.toLowerCase()}:${l.marketplace}`;
  const from = (p: Provenance, src = source): FieldProvenance => ({ p, source: src, at });
  const provenance: Record<string, FieldProvenance> = { countriesAvailable: from(l.provenance) };
  if (priced) provenance.sellingPrice = from(l.provenance);
  if (rated && l.rating !== null) provenance.rating = from(l.provenance, l.reviewSource!);
  if (rated && l.reviewCount !== null) provenance.reviewCount = from(l.provenance, l.reviewSource!);
  if (commission !== null) provenance.commissionPercentage = l.commissionRate !== null ? from(l.provenance) : from("MANUAL", "operator");
  return {
    values: {
      title: l.title,
      description: l.summary?.trim() || l.description || null,
      brand: l.brand,
      productUrl: l.productUrl,
      affiliateUrl: l.affiliateUrl,
      imageUrl: l.imageUrls[0] ?? null,
      gallery: l.imageUrls.slice(1),
      ...(l.currency ? { currency: l.currency } : {}),
      sellingPrice: priced ? l.price : null,
      // Networks that require prices to carry their observation time (Amazon) get it; the storefront then
      // shows the price only together with that time and the network's statement.
      priceAsOf: priced && policy?.priceDisclaimer ? l.dataFetchedAt : null,
      externalDataExpiresAt: dataExpiresAt(l.dataFetchedAt, provider?.maxDataAgeHours ?? null),
      available: l.availability !== "OUT_OF_STOCK",
      rating: rated ? l.rating : null,
      reviewCount: rated ? l.reviewCount : null,
      commissionPercentage: commission,
      estimatedMargin: commission,
      countriesAvailable: [l.country],
      highlights: l.features.slice(0, 10),
      problemSolved: l.problemSolved,
      targetAudience: l.targetAudience,
      tags: l.tags,
      businessModel: "AFFILIATE",
      lastCheckedAt: l.dataFetchedAt,
    },
    provenance,
  };
}

function mergeProvenance(existing: Record<string, FieldProvenance>, fromListing: Record<string, FieldProvenance>) {
  const out = { ...existing };
  for (const k of LISTING_TRACKED_FIELDS) delete out[k];
  return { ...out, ...fromListing };
}

/** The listing's storefront category: the one chosen in FORGE, else an existing category whose slug matches the network's category. */
async function storefrontCategoryId(ctx: ServiceContext, l: AffiliateProduct): Promise<string | null> {
  if (l.categoryId) return l.categoryId;
  const slugs = [...new Set([l.category, ...[...l.categoryPath].reverse()].filter((n): n is string => !!n).map((n) => slugify(n)).filter(Boolean))];
  if (!slugs.length) return null;
  const rows = await ctx.db.select({ id: categories.id, slug: categories.slug }).from(categories).where(and(eq(categories.organizationId, ctx.orgId), inArray(categories.slug, slugs)));
  for (const s of slugs) {
    const hit = rows.find((r) => r.slug === s);
    if (hit) return hit.id;
  }
  return null;
}

/** Creates or updates the listing's tracked link (/r/{code}) and makes it the product's primary link. */
async function ensureListingLink(ctx: ServiceContext, l: AffiliateProduct, productId: string): Promise<AffiliateLink | null> {
  if (!l.affiliateUrl) return null;
  const merchant = getAffiliateProvider(l.network)?.marketplaces().find((m) => m.id === l.marketplace)?.name ?? l.merchant ?? null;
  const commissionRate = l.commissionRate ?? l.expectedCommissionRate ?? null;
  const [existing] = await ctx.db.select().from(affiliateLinks).where(and(eq(affiliateLinks.affiliateProductId, l.id), eq(affiliateLinks.productId, productId))).limit(1);
  let link: AffiliateLink | undefined;
  if (existing) {
    const status = existing.status === "PAUSED" || existing.url !== l.affiliateUrl ? "UNCHECKED" : existing.status;
    [link] = await ctx.db.update(affiliateLinks).set({ url: l.affiliateUrl, status, isPrimary: true, networkId: l.networkId, merchant, commissionRate, country: l.country }).where(eq(affiliateLinks.id, existing.id)).returning();
  } else {
    for (let attempt = 0; attempt < 5 && !link; attempt++) {
      [link] = await ctx.db
        .insert(affiliateLinks)
        .values({ organizationId: ctx.orgId, productId, affiliateProductId: l.id, networkId: l.networkId, merchant, url: l.affiliateUrl, code: newLinkCode(), commissionRate, country: l.country, isPrimary: true, isDemo: l.isDemo })
        .onConflictDoNothing()
        .returning();
    }
    if (!link) throw new Error("Could not allocate a unique link code");
  }
  await ctx.db.update(affiliateLinks).set({ isPrimary: false }).where(and(eq(affiliateLinks.productId, productId), ne(affiliateLinks.id, link.id)));
  return link;
}

/**
 * Puts a listing on the storefront: creates its FORGE product (or refreshes and re-shows the one it
 * was published to before) and its tracked link, and links both back to the listing. Run inside the
 * publish transition's transaction. Returns the updated listing.
 */
export async function publishToStorefront(ctx: ServiceContext, l: AffiliateProduct): Promise<AffiliateProduct> {
  const { values, provenance } = productFieldsFromListing(l);
  const categoryId = await storefrontCategoryId(ctx, l);
  const sourceProductId = listingSourceId(l);
  const now = new Date();
  const [existing] = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.organizationId, ctx.orgId), l.productId ? eq(products.id, l.productId) : and(eq(products.source, "AFFILIATE_NETWORK"), eq(products.sourceProductId, sourceProductId))))
    .limit(1);
  let product: Product;
  if (existing) {
    // Keep a product the team moved into testing/scaling; bring back one that was paused or archived.
    const status = PUBLIC_PRODUCT_STATUSES.includes(existing.status) ? existing.status : "APPROVED";
    [product] = await ctx.db
      .update(products)
      .set({ ...values, categoryId: categoryId ?? existing.categoryId, fieldProvenance: mergeProvenance(existing.fieldProvenance, provenance), businessModels: [...new Set([...existing.businessModels, "AFFILIATE"])], status, ...(status !== existing.status ? { statusChangedAt: now } : {}) })
      .where(eq(products.id, existing.id))
      .returning();
  } else {
    [product] = await ctx.db
      .insert(products)
      .values({ ...values, organizationId: ctx.orgId, title: l.title, slug: await uniqueSlug(ctx, l.title), categoryId, source: "AFFILIATE_NETWORK", sourceProductId, businessModels: ["AFFILIATE"], status: "APPROVED", statusChangedAt: now, fieldProvenance: provenance, isDemo: l.isDemo })
      .returning();
  }
  await ensureListingLink(ctx, l, product.id);
  const [updated] = await ctx.db.update(affiliateProducts).set({ productId: product.id }).where(eq(affiliateProducts.id, l.id)).returning();
  return updated;
}

/** Takes a listing's product off the storefront (unpublish → PAUSED, archive → ARCHIVED) and pauses its tracked links. */
export async function takeDownFromStorefront(ctx: ServiceContext, l: AffiliateProduct, productStatus: "PAUSED" | "ARCHIVED") {
  await ctx.db.update(affiliateLinks).set({ status: "PAUSED" }).where(eq(affiliateLinks.affiliateProductId, l.id));
  if (!l.productId) return;
  const now = new Date();
  await ctx.db
    .update(products)
    .set({ status: productStatus, statusChangedAt: now })
    .where(and(eq(products.id, l.productId), eq(products.organizationId, ctx.orgId), ne(products.status, productStatus)));
  await ctx.db.update(productTests).set({ status: "COMPLETED", endedAt: now }).where(and(eq(productTests.productId, l.productId), eq(productTests.status, "RUNNING")));
}

/** After a refresh or an edit of a PUBLISHED listing: rewrites its product's network fields and the tracked link's destination. */
export async function syncStorefrontProduct(ctx: ServiceContext, l: AffiliateProduct): Promise<boolean> {
  if (l.status !== "PUBLISHED" || !l.productId) return false;
  const [existing] = await ctx.db.select().from(products).where(and(eq(products.id, l.productId), eq(products.organizationId, ctx.orgId))).limit(1);
  if (!existing) return false;
  const { values, provenance } = productFieldsFromListing(l);
  await ctx.db
    .update(products)
    .set({ ...values, categoryId: l.categoryId ?? existing.categoryId, fieldProvenance: mergeProvenance(existing.fieldProvenance, provenance) })
    .where(eq(products.id, existing.id));
  if (l.affiliateUrl) {
    await ctx.db
      .update(affiliateLinks)
      .set({ url: l.affiliateUrl, status: "UNCHECKED" })
      .where(and(eq(affiliateLinks.affiliateProductId, l.id), ne(affiliateLinks.url, l.affiliateUrl), ne(affiliateLinks.status, "PAUSED")));
  }
  return true;
}
