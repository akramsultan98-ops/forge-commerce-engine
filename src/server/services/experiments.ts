// A/B experimentation for landing pages: headline, hero image, CTA, angle, structure, video hook…

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { EXPERIMENT_TYPES } from "@/lib/constants";
import { hashString } from "@/lib/utils";
import { assignVariant, compareProportions } from "@/domain/stats";
import { assertCan, type ServiceContext } from "../context";
import type { Database } from "../db/client";
import { experiments, landingPages, type Experiment, type ExperimentVariant, type LandingPage, type LandingPageSection } from "../db/schema";
import { audit } from "../audit";
import { NotFoundError, ValidationError } from "../errors";

const VariantSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,20}$/),
  name: z.string().trim().min(1).max(60),
  weight: z.number().min(0).max(100),
  changes: z.record(z.string(), z.unknown()),
});

const ExperimentInput = z.object({
  landingPageId: z.string().uuid(),
  name: z.string().trim().min(3).max(120),
  type: z.enum(EXPERIMENT_TYPES),
  hypothesis: z.string().trim().max(500).optional(),
  primaryMetric: z.enum(["AFFILIATE_CTR", "PRODUCT_CTR"]).default("AFFILIATE_CTR"),
  variants: z.array(VariantSchema).min(2).max(4),
});

export async function createExperiment(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx, "experiments:write");
  const parsed = ExperimentInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid experiment", parsed.error.issues);
  const [page] = await ctx.db.select().from(landingPages).where(and(eq(landingPages.id, parsed.data.landingPageId), eq(landingPages.organizationId, ctx.orgId))).limit(1);
  if (!page) throw new NotFoundError("Landing page");
  if (new Set(parsed.data.variants.map((v) => v.key)).size !== parsed.data.variants.length) throw new ValidationError("Variant keys must be unique");
  const [row] = await ctx.db
    .insert(experiments)
    .values({ organizationId: ctx.orgId, productId: page.productId, landingPageId: page.id, name: parsed.data.name, type: parsed.data.type, hypothesis: parsed.data.hypothesis ?? null, primaryMetric: parsed.data.primaryMetric, variants: parsed.data.variants })
    .returning();
  await audit(ctx, "experiment.create", { type: "experiment", id: row.id });
  return row;
}

/** Quick-start: a two-variant test derived from the page's current values. */
export async function createQuickExperiment(ctx: ServiceContext, landingPageId: string, type: "HEADLINE" | "CTA" | "STRUCTURE", challenger: string) {
  const [page] = await ctx.db.select().from(landingPages).where(and(eq(landingPages.id, landingPageId), eq(landingPages.organizationId, ctx.orgId))).limit(1);
  if (!page) throw new NotFoundError("Landing page");
  const control: ExperimentVariant = { key: "control", name: "Control", weight: 50, changes: {} };
  const b: ExperimentVariant =
    type === "HEADLINE"
      ? { key: "b", name: "Challenger headline", weight: 50, changes: { headline: challenger } }
      : type === "CTA"
        ? { key: "b", name: "Challenger CTA", weight: 50, changes: { ctaLabel: challenger } }
        : { key: "b", name: "Demo above the fold", weight: 50, changes: { moveToTop: "DEMO", compactHero: true } };
  return createExperiment(ctx, { landingPageId, name: `${type.toLowerCase()} test — ${page.headline.slice(0, 40)}`, type, hypothesis: type === "STRUCTURE" ? "A shorter hero with the demo above the fold increases click-through." : undefined, variants: [control, b] });
}

export async function setExperimentStatus(ctx: ServiceContext, id: string, status: "RUNNING" | "STOPPED" | "COMPLETED", winnerVariant?: string) {
  assertCan(ctx, "experiments:write");
  const [exp] = await ctx.db.select().from(experiments).where(and(eq(experiments.id, id), eq(experiments.organizationId, ctx.orgId))).limit(1);
  if (!exp) throw new NotFoundError("Experiment");
  if (status === "RUNNING" && exp.landingPageId) {
    // One running experiment per page keeps results clean.
    await ctx.db.update(experiments).set({ status: "STOPPED", endedAt: new Date() }).where(and(eq(experiments.landingPageId, exp.landingPageId), eq(experiments.status, "RUNNING")));
  }
  await ctx.db
    .update(experiments)
    .set({ status, startedAt: status === "RUNNING" ? (exp.startedAt ?? new Date()) : exp.startedAt, endedAt: status === "RUNNING" ? null : new Date(), winnerVariant: winnerVariant ?? exp.winnerVariant })
    .where(eq(experiments.id, id));
  await audit(ctx, `experiment.${status.toLowerCase()}`, { type: "experiment", id });
}

export async function listExperiments(ctx: Pick<ServiceContext, "db" | "orgId">, opts: { landingPageId?: string; productId?: string } = {}) {
  return ctx.db
    .select()
    .from(experiments)
    .where(and(eq(experiments.organizationId, ctx.orgId), opts.landingPageId ? eq(experiments.landingPageId, opts.landingPageId) : undefined, opts.productId ? eq(experiments.productId, opts.productId) : undefined))
    .orderBy(desc(experiments.createdAt));
}

export async function experimentResults(ctx: Pick<ServiceContext, "db" | "orgId">, exp: Experiment) {
  const convType = exp.primaryMetric === "PRODUCT_CTR" ? "PRODUCT_CLICK" : "AFFILIATE_CLICK";
  const res = await ctx.db.execute(sql`
    select variant,
           count(*) filter (where event_type = 'PAGE_VIEW')::int as impressions,
           count(*) filter (where event_type = ${convType})::int as conversions
    from click_events where experiment_id = ${exp.id} and is_bot = false group by variant`);
  const byKey = new Map((res.rows as Array<{ variant: string; impressions: number; conversions: number }>).map((r) => [r.variant, { impressions: Number(r.impressions), conversions: Number(r.conversions) }]));
  const control = byKey.get(exp.variants[0].key) ?? { impressions: 0, conversions: 0 };
  return exp.variants.map((v, i) => {
    const s = byKey.get(v.key) ?? { impressions: 0, conversions: 0 };
    return { key: v.key, name: v.name, ...s, rate: s.impressions ? s.conversions / s.impressions : 0, vsControl: i === 0 ? null : compareProportions(control.conversions, control.impressions, s.conversions, s.impressions) };
  });
}

export async function runningExperimentFor(db: Database, landingPageId: string): Promise<Experiment | null> {
  const [row] = await db.select().from(experiments).where(and(eq(experiments.landingPageId, landingPageId), eq(experiments.status, "RUNNING"))).limit(1);
  return row ?? null;
}

export function bucketVisitor(exp: Experiment, visitorId: string): string {
  return assignVariant(hashString(`${exp.id}:${visitorId}`), exp.variants);
}

/** Applies a variant's changes to the page + sections before rendering. */
export function applyVariant(page: LandingPage, sections: LandingPageSection[], variant: ExperimentVariant | undefined) {
  if (!variant || !Object.keys(variant.changes).length) return { page, sections };
  const ch = variant.changes as Record<string, unknown>;
  const nextPage = { ...page, headline: typeof ch.headline === "string" ? ch.headline : page.headline, ctaLabel: typeof ch.ctaLabel === "string" ? ch.ctaLabel : page.ctaLabel, subheadline: typeof ch.subheadline === "string" ? ch.subheadline : page.subheadline };
  let nextSections = sections.map((s) => {
    if (s.type !== "HERO") return s;
    const c = { ...(s.content as Record<string, unknown>) };
    if (typeof ch.headline === "string") c.headline = ch.headline;
    if (typeof ch.ctaLabel === "string") c.ctaLabel = ch.ctaLabel;
    if (typeof ch.subheadline === "string") c.subheadline = ch.subheadline;
    if (typeof ch.imageUrl === "string") c.imageUrl = ch.imageUrl;
    if (typeof ch.videoUrl === "string") c.videoUrl = ch.videoUrl;
    if (ch.compactHero) c.subheadline = "";
    return { ...s, content: c };
  });
  if (typeof ch.moveToTop === "string") {
    const idx = nextSections.findIndex((s) => s.type === ch.moveToTop);
    if (idx > 1) {
      const [moved] = nextSections.splice(idx, 1);
      nextSections = [nextSections[0], moved, ...nextSections.slice(1)];
    }
  }
  return { page: nextPage, sections: nextSections };
}
