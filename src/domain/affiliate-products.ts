// Review lifecycle, publishing rules and data-freshness rules for network product listings
// (affiliate_products). Pure and dependency-free — shared by the service, the API, the admin UI and
// future n8n workflows.

import type { AffiliateProductStatus } from "@/lib/constants";

export const AFFILIATE_ACTIONS = ["submit", "approve", "reject", "publish", "unpublish", "archive", "restore"] as const;
export type AffiliateAction = (typeof AFFILIATE_ACTIONS)[number];

/**
 * DISCOVERED →submit→ REVIEW →approve→ APPROVED →publish→ PUBLISHED →archive→ ARCHIVED.
 * reject → REJECTED (before publishing); unpublish → back to APPROVED; restore → REVIEW.
 */
export const AFFILIATE_TRANSITIONS: Record<AffiliateAction, { from: readonly AffiliateProductStatus[]; to: AffiliateProductStatus }> = {
  submit: { from: ["DISCOVERED"], to: "REVIEW" },
  approve: { from: ["REVIEW"], to: "APPROVED" },
  reject: { from: ["DISCOVERED", "REVIEW", "APPROVED"], to: "REJECTED" },
  publish: { from: ["APPROVED"], to: "PUBLISHED" },
  unpublish: { from: ["PUBLISHED"], to: "APPROVED" },
  archive: { from: ["DISCOVERED", "REVIEW", "APPROVED", "PUBLISHED", "REJECTED"], to: "ARCHIVED" },
  restore: { from: ["REJECTED", "ARCHIVED"], to: "REVIEW" },
};

/**
 * Who may take each action. Machines (automation API keys, e.g. n8n) prepare listings and can take
 * them *off* the storefront when something breaks; review decisions belong to people.
 */
export const ACTION_PERMISSION: Record<AffiliateAction, "affiliate:ingest" | "affiliate:review"> = {
  submit: "affiliate:ingest",
  approve: "affiliate:review",
  reject: "affiliate:review",
  publish: "affiliate:review",
  unpublish: "affiliate:ingest",
  archive: "affiliate:ingest",
  restore: "affiliate:review",
};

/** Decisions that put a listing in front of shoppers: only a signed-in person may take them — never an API key. */
export const HUMAN_ONLY_ACTIONS: readonly AffiliateAction[] = ["approve", "publish"];

/** Statuses in which automations may still edit FORGE-owned fields (enrichment before a person reviews). */
export const MACHINE_EDITABLE_STATUSES: readonly AffiliateProductStatus[] = ["DISCOVERED", "REVIEW"];

/** The status an action leads to, or null when the action is not allowed from `current`. */
export function nextStatus(current: AffiliateProductStatus, action: AffiliateAction): AffiliateProductStatus | null {
  const t = AFFILIATE_TRANSITIONS[action];
  return t.from.includes(current) ? t.to : null;
}

export function allowedActions(current: AffiliateProductStatus): AffiliateAction[] {
  return AFFILIATE_ACTIONS.filter((a) => AFFILIATE_TRANSITIONS[a].from.includes(current));
}

/** Amazon's licence: product data — and links to its images — may be cached for at most 24 hours before a refresh from the API. */
export const AMAZON_MAX_DATA_AGE_HOURS = 24;

export function dataAgeHours(fetchedAt: Date | null, now = new Date()): number | null {
  return fetchedAt ? Math.max(0, (now.getTime() - fetchedAt.getTime()) / 3_600_000) : null;
}

/** True when the listing may still be shown; always true for networks without a freshness rule (maxAgeHours = null). */
export function isDataFresh(fetchedAt: Date | null, maxAgeHours: number | null, now = new Date()): boolean {
  if (maxAgeHours === null) return true;
  const age = dataAgeHours(fetchedAt, now);
  return age !== null && age < maxAgeHours;
}

/** When displayed network data must disappear from the storefront (null = no freshness rule). */
export function dataExpiresAt(fetchedAt: Date | null, maxAgeHours: number | null): Date | null {
  if (maxAgeHours === null) return null;
  return new Date((fetchedAt?.getTime() ?? 0) + maxAgeHours * 3_600_000);
}

export interface PublishCandidate {
  affiliateUrl: string | null;
  productUrl?: string | null;
  imageUrls?: string[];
  description?: string | null;
  summary?: string | null;
  category?: string | null;
  categoryId?: string | null;
  availability: string;
  dataFetchedAt: Date | null;
}

/** Why an APPROVED listing cannot be published yet — empty when it can. */
export function publishBlockers(p: PublishCandidate, maxAgeHours: number | null, now = new Date()): string[] {
  const out: string[] = [];
  if (!p.affiliateUrl) out.push("it has no affiliate URL (the network must supply the tagged link)");
  if (!p.productUrl) out.push("it has no product URL");
  if (!p.imageUrls?.length) out.push("it has no image");
  if (!(p.summary?.trim() || p.description?.trim())) out.push("it has no description — the network supplied none, so write a FORGE summary");
  if (!p.categoryId && !p.category?.trim()) out.push("it has no category — choose a storefront category");
  if (p.availability === "OUT_OF_STOCK") out.push("it is out of stock");
  if (!isDataFresh(p.dataFetchedAt, maxAgeHours, now)) out.push(`its data is older than ${maxAgeHours} hours — refresh it from the network first`);
  return out;
}

/**
 * Storefront product fields that come from the network listing while a product is published from
 * one. They are rewritten on every refresh and cannot be edited on the product — editing them would
 * break provenance (and, for Amazon, the licence). FORGE-owned fields live on the listing.
 */
export const PROVIDER_OWNED_PRODUCT_FIELDS = [
  "title",
  "description",
  "brand",
  "productUrl",
  "affiliateUrl",
  "imageUrl",
  "sellingPrice",
  "currency",
  "rating",
  "reviewCount",
  "highlights",
  "countriesAvailable",
] as const;

/** FORGE-owned listing fields (editable by people; by automations only before review). */
export const LISTING_EDITABLE_FIELDS = ["categoryId", "summary", "problemSolved", "targetAudience", "tags", "expectedCommissionRate"] as const;
export type ListingEditableField = (typeof LISTING_EDITABLE_FIELDS)[number];
