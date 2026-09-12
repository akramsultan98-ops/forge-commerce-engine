// Assembles everything a public product / landing page needs: sections (published landing page,
// else generated from the product's facts), A/B variant, and a CTA that carries UTMs + experiment.

import "server-only";
import { eq } from "drizzle-orm";
import type { SectionType } from "@/lib/constants";
import { TEMPLATE_LAYOUTS } from "@/lib/landing-sections";
import type { AffiliateLink, LandingPage, LandingPageSection, ProductScore } from "../db/schema";
import { categories } from "../db/schema";
import { buildBrief } from "../ai/brief";
import { templateCopy, templateLandingSections } from "../ai/templates";
import { applyVariant, bucketVisitor, runningExperimentFor } from "./experiments";
import { storefront, type PublicProduct } from "./storefront";
import type { RenderSection } from "@/components/store/LandingRenderer";

const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export function ctaHrefFor(link: AffiliateLink | null, sp: Record<string, string | string[] | undefined>, exp: { id: string; variant: string } | null): string | null {
  if (!link || link.status === "PAUSED") return null;
  const params = new URLSearchParams();
  for (const k of UTM) {
    const v = sp[k];
    if (typeof v === "string" && v) params.set(k, v.slice(0, 100));
  }
  if (exp) {
    params.set("x", exp.id);
    params.set("v", exp.variant);
  }
  const qs = params.toString();
  return `/r/${link.code}${qs ? `?${qs}` : ""}`;
}

export interface ProductPageModel {
  sections: RenderSection[];
  page: LandingPage | null;
  experiment: { id: string; variant: string } | null;
  ctaHref: string | null;
  ctaLabel: string;
  faqs: Array<{ q: string; a: string }>;
  generated: boolean;
}

export async function productPageModel(
  product: PublicProduct,
  opts: { landing: { page: LandingPage; sections: LandingPageSection[] } | null; score: ProductScore | null; link: AffiliateLink | null; searchParams: Record<string, string | string[] | undefined>; visitorId: string | null },
): Promise<ProductPageModel> {
  const { db, settings } = await storefront();
  let page = opts.landing?.page ?? null;
  let rawSections: RenderSection[];
  let generated = false;
  if (opts.landing && page) {
    rawSections = opts.landing.sections.map((s) => ({ id: s.id, type: s.type, enabled: s.enabled, content: s.content as Record<string, unknown> }));
  } else {
    // No published page yet: render a deterministic page from verified product facts.
    const [cat] = product.categoryId ? await db.select().from(categories).where(eq(categories.id, product.categoryId)).limit(1) : [];
    const brief = buildBrief(product, cat ?? null, opts.score);
    const copy = templateCopy(brief, { returns: settings.returnsSummary, shipping: settings.shippingSummary });
    rawSections = templateLandingSections(brief, copy, TEMPLATE_LAYOUTS.PROBLEM_SOLUTION, { disclosure: settings.affiliateDisclosure, returns: settings.returnsSummary, shipping: settings.shippingSummary, template: "PROBLEM_SOLUTION" }).map((s, i) => ({
      id: `generated-${i}`,
      type: s.type as SectionType,
      enabled: true,
      content: s.content,
    }));
    generated = true;
  }

  let experiment: ProductPageModel["experiment"] = null;
  if (page) {
    const exp = await runningExperimentFor(db, page.id);
    if (exp) {
      const variant = opts.visitorId ? bucketVisitor(exp, opts.visitorId) : bucketVisitor(exp, crypto.randomUUID());
      experiment = { id: exp.id, variant };
      const applied = applyVariant(page, rawSections as unknown as LandingPageSection[], exp.variants.find((v) => v.key === variant));
      page = applied.page;
      rawSections = applied.sections as unknown as RenderSection[];
    }
  }

  const faqSection = rawSections.find((s) => s.type === "FAQ" && s.enabled);
  const faqs = Array.isArray((faqSection?.content as { items?: unknown })?.items) ? ((faqSection!.content as { items: Array<{ q: string; a: string }> }).items ?? []) : [];
  return {
    sections: rawSections,
    page,
    experiment,
    ctaHref: ctaHrefFor(opts.link, opts.searchParams, experiment),
    ctaLabel: page?.ctaLabel ?? (product.businessModel === "AFFILIATE" ? "Check price" : "Get yours"),
    faqs,
    generated,
  };
}
