// ProductBrief — the normalized, provenance-aware product summary handed to AI prompts and the
// template engine. Only facts the system actually holds go in; the prompt tells models so.

import type { BusinessModel, RiskLevel } from "@/lib/constants";
import type { Category, Product, ProductScore } from "../db/schema";

export interface ProductBrief {
  id: string;
  title: string;
  shortName: string;
  slug: string;
  description: string;
  category: string;
  categorySlug: string;
  brand: string | null;
  problem: string;
  audience: string;
  highlights: string[];
  tags: string[];
  price: number | null;
  cost: number | null;
  shippingCost: number | null;
  currency: string;
  commissionPct: number | null;
  commission: number | null;
  businessModel: BusinessModel;
  shippingDaysMin: number | null;
  shippingDaysMax: number | null;
  /** Rating only when it came from a real, attributable source. */
  rating: { value: number; count: number; source: string } | null;
  score: number | null;
  confidence: number | null;
  reasons: string[];
  warnings: string[];
  riskFlags: string[];
  riskLevel: RiskLevel | null;
  factors: Record<string, { score: number; provenance: string; note: string }>;
  isDemo: boolean;
}

export function shortNameOf(title: string): string {
  return title.split(/\s[–—-]\s|\s\(|,\s/)[0].trim();
}

export function buildBrief(p: Product, category?: Pick<Category, "name" | "slug"> | null, score?: Pick<ProductScore, "overall" | "confidence" | "reasons" | "warnings" | "factors"> | null): ProductBrief {
  const ratingProv = p.fieldProvenance?.rating?.p;
  const commission = p.affiliateCommission ?? (p.sellingPrice && p.commissionPercentage ? (p.sellingPrice * p.commissionPercentage) / 100 : null);
  return {
    id: p.id,
    title: p.title,
    shortName: shortNameOf(p.title),
    slug: p.slug,
    description: p.description ?? "",
    category: category?.name ?? "General",
    categorySlug: category?.slug ?? "general",
    brand: p.brand,
    problem: p.problemSolved?.trim() || `the everyday hassle ${shortNameOf(p.title).toLowerCase()} is designed to fix`,
    audience: p.targetAudience?.trim() || "people who want small, practical upgrades",
    highlights: p.highlights ?? [],
    tags: p.tags ?? [],
    price: p.sellingPrice,
    cost: p.cost,
    shippingCost: p.shippingCost,
    currency: p.currency,
    commissionPct: p.commissionPercentage,
    commission,
    businessModel: p.businessModel,
    shippingDaysMin: p.shippingDaysMin,
    shippingDaysMax: p.shippingDaysMax,
    rating: ratingProv === "REAL" && p.rating && p.reviewCount ? { value: p.rating, count: p.reviewCount, source: p.fieldProvenance.rating?.source ?? "source" } : null,
    score: score?.overall ?? p.overallScore,
    confidence: score?.confidence ?? p.scoreConfidence,
    reasons: score?.reasons ?? [],
    warnings: score?.warnings ?? [],
    riskFlags: p.riskFlags ?? [],
    riskLevel: p.riskLevel,
    factors: Object.fromEntries(Object.entries(score?.factors ?? {}).map(([k, v]) => [k, { score: v.score, provenance: v.provenance, note: v.note }])),
    isDemo: p.isDemo,
  };
}

/** Compact, explicit fact sheet for prompts — models are told these are the ONLY facts available. */
export function briefToPrompt(b: ProductBrief): string {
  const lines = [
    `Product: ${b.title}`,
    `Category: ${b.category}`,
    b.brand ? `Brand: ${b.brand}` : null,
    `Business model: ${b.businessModel}`,
    `Problem it solves: ${b.problem}`,
    `Target audience: ${b.audience}`,
    b.description ? `Description: ${b.description}` : null,
    b.highlights.length ? `Verified highlights: ${b.highlights.join("; ")}` : null,
    b.price !== null ? `Selling price: ${b.price} ${b.currency}` : "Selling price: unknown",
    b.cost !== null ? `Supplier cost: ${b.cost} ${b.currency}` : null,
    b.commissionPct !== null ? `Affiliate commission: ${b.commissionPct}%` : null,
    b.shippingDaysMax !== null ? `Shipping: ${b.shippingDaysMin ?? "?"}–${b.shippingDaysMax} days` : null,
    b.rating ? `Rating: ${b.rating.value} from ${b.rating.count} reviews (${b.rating.source})` : "Rating: not available — do not invent one",
    b.score !== null ? `FORGE score: ${b.score}/100 (confidence ${b.confidence})` : null,
    Object.keys(b.factors).length
      ? `Factor evidence:\n${Object.entries(b.factors)
          .map(([k, f]) => `  - ${k}: ${f.score} [${f.provenance}] ${f.note}`)
          .join("\n")}`
      : null,
    b.warnings.length ? `Warnings: ${b.warnings.join("; ")}` : null,
    b.riskFlags.length ? `Risk flags: ${b.riskFlags.join("; ")}` : null,
    b.isDemo ? "NOTE: this product is DEMO data; do not describe it as a real market observation." : null,
  ];
  return lines.filter(Boolean).join("\n");
}
