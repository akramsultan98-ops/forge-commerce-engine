import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { LANDING_TEMPLATES, SECTION_TYPES, type GenerationMethod, type LandingTemplate, type SectionType } from "@/lib/constants";
import { SECTION_SCHEMAS, TEMPLATE_LAYOUTS } from "@/lib/landing-sections";
import { slugify } from "@/lib/utils";
import { assertCan, type ServiceContext } from "../context";
import type { Database } from "../db/client";
import { landingPageSections, landingPages, products, type LandingPage } from "../db/schema";
import { audit } from "../audit";
import { NotFoundError, ValidationError } from "../errors";

export async function listLandingPages(ctx: Pick<ServiceContext, "db" | "orgId">, opts: { productId?: string } = {}) {
  return ctx.db
    .select({ page: landingPages, productTitle: products.title, productSlug: products.slug })
    .from(landingPages)
    .innerJoin(products, eq(products.id, landingPages.productId))
    .where(and(eq(landingPages.organizationId, ctx.orgId), opts.productId ? eq(landingPages.productId, opts.productId) : undefined))
    .orderBy(desc(landingPages.updatedAt));
}

export async function getLandingPage(ctx: Pick<ServiceContext, "db" | "orgId">, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Landing page");
  const [page] = await ctx.db.select().from(landingPages).where(and(eq(landingPages.id, id), eq(landingPages.organizationId, ctx.orgId))).limit(1);
  if (!page) throw new NotFoundError("Landing page");
  const sections = await ctx.db.select().from(landingPageSections).where(eq(landingPageSections.landingPageId, id)).orderBy(asc(landingPageSections.position));
  return { page, sections };
}

/** Public lookup: a published page by slug. */
export async function getPublishedLandingPage(db: Database, orgId: string, slug: string) {
  const [page] = await db
    .select()
    .from(landingPages)
    .where(and(eq(landingPages.organizationId, orgId), eq(landingPages.slug, slug), eq(landingPages.status, "PUBLISHED")))
    .limit(1);
  if (!page) return null;
  const sections = await db.select().from(landingPageSections).where(eq(landingPageSections.landingPageId, page.id)).orderBy(asc(landingPageSections.position));
  return { page, sections };
}

/** The page used to render /products/[slug]: newest published, else newest draft (for preview). */
export async function getPrimaryPageForProduct(db: Database, productId: string, opts: { publishedOnly?: boolean } = {}) {
  const pages = await db
    .select()
    .from(landingPages)
    .where(and(eq(landingPages.productId, productId), opts.publishedOnly ? eq(landingPages.status, "PUBLISHED") : inArray(landingPages.status, ["PUBLISHED", "DRAFT"])))
    .orderBy(desc(landingPages.updatedAt));
  const page = pages.find((p) => p.status === "PUBLISHED") ?? pages[0];
  if (!page) return null;
  const sections = await db.select().from(landingPageSections).where(eq(landingPageSections.landingPageId, page.id)).orderBy(asc(landingPageSections.position));
  return { page, sections };
}

async function uniquePageSlug(ctx: ServiceContext, base: string) {
  const root = slugify(base, 60);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const clash = await ctx.db.select({ id: landingPages.id }).from(landingPages).where(and(eq(landingPages.organizationId, ctx.orgId), eq(landingPages.slug, candidate))).limit(1);
    if (!clash.length) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export interface NewLandingPageInput {
  productId: string;
  productSlug: string;
  template: LandingTemplate;
  headline: string;
  subheadline: string;
  seoTitle: string;
  metaDescription: string;
  ctaLabel: string;
  sections: Array<{ type: string; content: Record<string, unknown> }>;
  generationMethod: GenerationMethod;
  model?: string | null;
  agentRunId?: string | null;
  isDemo?: boolean;
  storeId?: string | null;
}

export async function createLandingPage(ctx: ServiceContext, input: NewLandingPageInput): Promise<LandingPage> {
  const slug = await uniquePageSlug(ctx, `${input.productSlug}${input.template === "PROBLEM_SOLUTION" ? "" : `-${input.template.toLowerCase().replace(/_/g, "-")}`}`);
  const [page] = await ctx.db
    .insert(landingPages)
    .values({
      organizationId: ctx.orgId,
      productId: input.productId,
      storeId: input.storeId ?? null,
      slug,
      template: input.template,
      status: "DRAFT",
      headline: input.headline.slice(0, 140),
      subheadline: input.subheadline.slice(0, 300),
      seoTitle: input.seoTitle.slice(0, 70),
      metaDescription: input.metaDescription.slice(0, 160),
      canonicalPath: `/products/${input.productSlug}`,
      ctaLabel: input.ctaLabel.slice(0, 40),
      generationMethod: input.generationMethod,
      model: input.model ?? null,
      agentRunId: input.agentRunId ?? null,
      isDemo: input.isDemo ?? false,
    })
    .returning();
  const rows = input.sections
    .filter((s) => (SECTION_TYPES as readonly string[]).includes(s.type))
    .map((s, i) => {
      const type = s.type as SectionType;
      const parsed = SECTION_SCHEMAS[type].safeParse(s.content);
      return { landingPageId: page.id, type, position: i, content: (parsed.success ? parsed.data : SECTION_SCHEMAS[type].parse({})) as Record<string, unknown> };
    });
  if (rows.length) await ctx.db.insert(landingPageSections).values(rows);
  await audit(ctx, "landing_page.create", { type: "landing_page", id: page.id }, { template: input.template, method: input.generationMethod });
  return page;
}

const PageMetaSchema = z.object({
  headline: z.string().trim().min(3).max(140).optional(),
  subheadline: z.string().trim().max(300).optional(),
  seoTitle: z.string().trim().min(3).max(70).optional(),
  metaDescription: z.string().trim().min(10).max(160).optional(),
  ctaLabel: z.string().trim().min(2).max(40).optional(),
  ogImage: z.string().trim().max(2048).regex(/^(https?:\/\/\S+)?$/).optional(),
});

export async function updateLandingPageMeta(ctx: ServiceContext, id: string, raw: unknown) {
  assertCan(ctx, "landing:write");
  await getLandingPage(ctx, id);
  const parsed = PageMetaSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid page settings", parsed.error.issues);
  const [row] = await ctx.db.update(landingPages).set(parsed.data).where(eq(landingPages.id, id)).returning();
  await audit(ctx, "landing_page.update", { type: "landing_page", id });
  return row;
}

async function sectionWithPage(ctx: ServiceContext, sectionId: string) {
  const [row] = await ctx.db
    .select({ section: landingPageSections, orgId: landingPages.organizationId })
    .from(landingPageSections)
    .innerJoin(landingPages, eq(landingPages.id, landingPageSections.landingPageId))
    .where(eq(landingPageSections.id, sectionId))
    .limit(1);
  if (!row || row.orgId !== ctx.orgId) throw new NotFoundError("Section");
  return row.section;
}

export async function updateSection(ctx: ServiceContext, sectionId: string, patch: { content?: unknown; enabled?: boolean }) {
  assertCan(ctx, "landing:write");
  const section = await sectionWithPage(ctx, sectionId);
  const set: Partial<typeof landingPageSections.$inferInsert> = {};
  if (patch.content !== undefined) {
    const parsed = SECTION_SCHEMAS[section.type].safeParse(patch.content);
    if (!parsed.success) throw new ValidationError(`Invalid ${section.type} content`, parsed.error.issues);
    set.content = parsed.data as Record<string, unknown>;
  }
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  await ctx.db.update(landingPageSections).set(set).where(eq(landingPageSections.id, sectionId));
  await ctx.db.update(landingPages).set({ updatedAt: new Date() }).where(eq(landingPages.id, section.landingPageId));
}

export async function moveSection(ctx: ServiceContext, sectionId: string, direction: "up" | "down") {
  assertCan(ctx, "landing:write");
  const section = await sectionWithPage(ctx, sectionId);
  const siblings = await ctx.db.select().from(landingPageSections).where(eq(landingPageSections.landingPageId, section.landingPageId)).orderBy(asc(landingPageSections.position));
  const idx = siblings.findIndex((s) => s.id === sectionId);
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= siblings.length) return;
  const reordered = [...siblings];
  [reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]];
  await ctx.db.transaction(async (tx) => {
    for (let i = 0; i < reordered.length; i++) await tx.update(landingPageSections).set({ position: i }).where(eq(landingPageSections.id, reordered[i].id));
  });
}

export async function addSection(ctx: ServiceContext, pageId: string, type: SectionType) {
  assertCan(ctx, "landing:write");
  await getLandingPage(ctx, pageId);
  if (!(SECTION_TYPES as readonly string[]).includes(type)) throw new ValidationError("Unknown section type");
  const [{ top }] = await ctx.db.select({ top: max(landingPageSections.position) }).from(landingPageSections).where(eq(landingPageSections.landingPageId, pageId));
  await ctx.db.insert(landingPageSections).values({ landingPageId: pageId, type, position: (top ?? -1) + 1, content: SECTION_SCHEMAS[type].parse({}) as Record<string, unknown> });
}

export async function removeSection(ctx: ServiceContext, sectionId: string) {
  assertCan(ctx, "landing:write");
  await sectionWithPage(ctx, sectionId);
  await ctx.db.delete(landingPageSections).where(eq(landingPageSections.id, sectionId));
}

export async function applyTemplateLayout(ctx: ServiceContext, pageId: string, template: LandingTemplate) {
  assertCan(ctx, "landing:write");
  if (!(LANDING_TEMPLATES as readonly string[]).includes(template)) throw new ValidationError("Unknown template");
  const { sections } = await getLandingPage(ctx, pageId);
  const layout = TEMPLATE_LAYOUTS[template].sections;
  await ctx.db.transaction(async (tx) => {
    let pos = 0;
    for (const type of layout) {
      const existing = sections.find((s) => s.type === type);
      if (existing) await tx.update(landingPageSections).set({ position: pos++, enabled: true }).where(eq(landingPageSections.id, existing.id));
      else await tx.insert(landingPageSections).values({ landingPageId: pageId, type, position: pos++, content: SECTION_SCHEMAS[type].parse({}) as Record<string, unknown> });
    }
    for (const s of sections.filter((s) => !layout.includes(s.type))) await tx.update(landingPageSections).set({ position: pos++, enabled: false }).where(eq(landingPageSections.id, s.id));
    await tx.update(landingPages).set({ template }).where(eq(landingPages.id, pageId));
  });
}

export async function setLandingPageStatus(ctx: ServiceContext, id: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
  assertCan(ctx, "landing:write");
  const { page } = await getLandingPage(ctx, id);
  await ctx.db
    .update(landingPages)
    .set({ status, publishedAt: status === "PUBLISHED" ? new Date() : page.publishedAt })
    .where(eq(landingPages.id, id));
  await audit(ctx, `landing_page.${status.toLowerCase()}`, { type: "landing_page", id });
}
