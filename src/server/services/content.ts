import { and, asc, count, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { CONTENT_STATUSES, type ContentStatus, type ContentType, type GenerationMethod, type Platform } from "@/lib/constants";
import { buildUtmUrl, contentUtmId, PLATFORM_UTM_SOURCE } from "@/domain/utm";
import { toCsv } from "@/domain/csv";
import { assertCan, type ServiceContext } from "../context";
import { campaigns, content, contentMetrics, landingPages, products, type Content, type Product } from "../db/schema";
import type { ContentConcept } from "../ai/schemas";
import { audit } from "../audit";
import { env } from "../env";
import { NotFoundError, ValidationError } from "../errors";

export async function ensureCampaign(ctx: ServiceContext, product: Pick<Product, "id" | "slug" | "title" | "isDemo">, platform: Platform) {
  const slug = `${product.slug}-${platform.toLowerCase()}`.slice(0, 90);
  const [existing] = await ctx.db.select().from(campaigns).where(and(eq(campaigns.organizationId, ctx.orgId), eq(campaigns.slug, slug))).limit(1);
  if (existing) return existing;
  const [row] = await ctx.db
    .insert(campaigns)
    .values({
      organizationId: ctx.orgId,
      name: `${product.title} · ${platform[0] + platform.slice(1).toLowerCase()}`,
      slug,
      productId: product.id,
      platform,
      objective: "Product test",
      status: "DRAFT",
      utmSource: PLATFORM_UTM_SOURCE[platform] ?? "other",
      utmMedium: "organic",
      utmCampaign: product.slug.slice(0, 100),
      isDemo: product.isDemo,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? (await ctx.db.select().from(campaigns).where(and(eq(campaigns.organizationId, ctx.orgId), eq(campaigns.slug, slug))).limit(1))[0];
}

async function nextSequence(ctx: ServiceContext, productId: string, contentType: ContentType): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(content)
    .where(and(eq(content.productId, productId), eq(content.contentType, contentType)));
  return Number(row?.n ?? 0) + 1;
}

export async function createContentFromConcepts(
  ctx: ServiceContext,
  product: Product,
  concepts: ContentConcept[],
  opts: { platform: Platform; contentType: ContentType; method: GenerationMethod; model?: string | null; agentRunId?: string | null; scheduleFrom?: Date | null },
): Promise<Content[]> {
  if (!concepts.length) return [];
  const campaign = await ensureCampaign(ctx, product, opts.platform);
  let seq = await nextSequence(ctx, product.id, opts.contentType);
  const disclosure = product.businessModel === "AFFILIATE" ? "Contains an affiliate link — disclose as #ad / “affiliate link” per platform rules." : null;
  const rows = concepts.map((c, i) => ({
    organizationId: ctx.orgId,
    productId: product.id,
    campaignId: campaign.id,
    platform: opts.platform,
    contentType: opts.contentType,
    angle: c.angle,
    title: c.title.slice(0, 200),
    hook: c.hook,
    script: c.beats.length ? c.beats : null,
    body: c.body || null,
    caption: c.caption,
    cta: c.cta,
    hashtags: c.hashtags,
    status: (c.beats.length ? "SCRIPTED" : "IDEA") as ContentStatus,
    scheduledAt: opts.scheduleFrom ? new Date(opts.scheduleFrom.getTime() + i * 86400_000) : null,
    utmContent: contentUtmId(opts.contentType, seq++),
    sponsoredDisclosure: disclosure,
    generationMethod: opts.method,
    model: opts.model ?? null,
    agentRunId: opts.agentRunId ?? null,
    isDemo: product.isDemo,
  }));
  return ctx.db.insert(content).values(rows).returning();
}

export interface ContentQuery {
  productId?: string;
  status?: ContentStatus;
  platform?: Platform;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export async function listContent(ctx: Pick<ServiceContext, "db" | "orgId">, q: ContentQuery = {}) {
  const conds: Array<SQL | undefined> = [eq(content.organizationId, ctx.orgId)];
  if (q.productId) conds.push(eq(content.productId, q.productId));
  if (q.status) conds.push(eq(content.status, q.status));
  if (q.platform) conds.push(eq(content.platform, q.platform));
  if (q.from) conds.push(gte(content.scheduledAt, q.from));
  if (q.to) conds.push(lt(content.scheduledAt, q.to));
  const where = and(...conds);
  const [items, [{ total }]] = await Promise.all([
    ctx.db
      .select({ item: content, productTitle: products.title, productSlug: products.slug })
      .from(content)
      .leftJoin(products, eq(products.id, content.productId))
      .where(where)
      .orderBy(q.from ? asc(content.scheduledAt) : desc(content.createdAt))
      .limit(Math.min(q.limit ?? 50, 500))
      .offset(q.offset ?? 0),
    ctx.db.select({ total: count() }).from(content).where(where),
  ]);
  return { items: items.map((r) => ({ ...r.item, productTitle: r.productTitle, productSlug: r.productSlug })), total: Number(total) };
}

export async function getContent(ctx: Pick<ServiceContext, "db" | "orgId">, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Content");
  const [row] = await ctx.db.select().from(content).where(and(eq(content.id, id), eq(content.organizationId, ctx.orgId))).limit(1);
  if (!row) throw new NotFoundError("Content");
  return row;
}

const ContentPatch = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  hook: z.string().trim().max(300).optional(),
  caption: z.string().trim().max(2200).optional(),
  cta: z.string().trim().max(200).optional(),
  body: z.string().trim().max(5000).optional(),
  status: z.enum(CONTENT_STATUSES).optional(),
  scheduledAt: z.preprocess((v) => (v === "" || v === null ? null : typeof v === "string" ? new Date(v) : v), z.date().nullable()).optional(),
  externalUrl: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^https?:\/\/\S+$/).max(2048).nullable()).optional(),
});

export async function updateContent(ctx: ServiceContext, id: string, raw: unknown) {
  assertCan(ctx, "content:write");
  const existing = await getContent(ctx, id);
  const parsed = ContentPatch.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid content update", parsed.error.issues);
  const patch: Partial<typeof content.$inferInsert> = { ...parsed.data };
  if (parsed.data.status === "SCHEDULED" && !parsed.data.scheduledAt && !existing.scheduledAt) throw new ValidationError("Set a publishing date before scheduling");
  if (parsed.data.status === "PUBLISHED" && !existing.publishedAt) patch.publishedAt = new Date();
  const [row] = await ctx.db.update(content).set(patch).where(eq(content.id, id)).returning();
  await audit(ctx, "content.update", { type: "content", id }, { fields: Object.keys(parsed.data) });
  return row;
}

/** Tracked destination for a content item: landing page (or product page) with full UTMs. */
export async function trackingUrlFor(ctx: Pick<ServiceContext, "db" | "orgId">, item: Pick<Content, "productId" | "platform" | "utmContent">) {
  if (!item.productId) return null;
  const [p] = await ctx.db.select({ slug: products.slug }).from(products).where(eq(products.id, item.productId)).limit(1);
  if (!p) return null;
  const [lp] = await ctx.db
    .select({ slug: landingPages.slug })
    .from(landingPages)
    .where(and(eq(landingPages.productId, item.productId), eq(landingPages.status, "PUBLISHED")))
    .orderBy(desc(landingPages.publishedAt))
    .limit(1);
  const path = lp ? `/lp/${lp.slug}` : `/products/${p.slug}`;
  return buildUtmUrl(new URL(path, env().APP_URL).toString(), { source: PLATFORM_UTM_SOURCE[item.platform] ?? "other", medium: "organic", campaign: p.slug, content: item.utmContent });
}

const MetricsInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  views: z.coerce.number().int().min(0).default(0),
  reach: z.coerce.number().int().min(0).default(0),
  likes: z.coerce.number().int().min(0).default(0),
  comments: z.coerce.number().int().min(0).default(0),
  shares: z.coerce.number().int().min(0).default(0),
  saves: z.coerce.number().int().min(0).default(0),
  profileVisits: z.coerce.number().int().min(0).default(0),
  clicks: z.coerce.number().int().min(0).default(0),
  cost: z.coerce.number().min(0).default(0),
});

/** Manual (or API-synced) platform metrics for a content item — upserted per day. */
export async function recordContentMetrics(ctx: ServiceContext, contentId: string, raw: unknown, provenance: "MANUAL" | "REAL" | "DEMO" = "MANUAL", source = "manual") {
  assertCan(ctx, "content:write");
  await getContent(ctx, contentId);
  const parsed = MetricsInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid metrics", parsed.error.issues);
  const { date, ...m } = parsed.data;
  await ctx.db
    .insert(contentMetrics)
    .values({ contentId, date, ...m, provenance, source })
    .onConflictDoUpdate({ target: [contentMetrics.contentId, contentMetrics.date], set: { ...m, provenance, source } });
  const [c] = await ctx.db.select({ status: content.status }).from(content).where(eq(content.id, contentId)).limit(1);
  if (c?.status === "PUBLISHED") await ctx.db.update(content).set({ status: "ANALYZING" }).where(eq(content.id, contentId));
}

export interface ContentPerformanceRow {
  id: string;
  title: string;
  hook: string | null;
  angle: string | null;
  platform: string;
  contentType: string;
  productId: string | null;
  productTitle: string | null;
  status: string;
  utmContent: string | null;
  views: number;
  engagements: number;
  platformClicks: number;
  siteVisits: number;
  affiliateClicks: number;
  conversions: number;
  engagementRate: number;
  ctr: number;
}

/** Joins platform metrics (content_metrics) with FORGE's own tracking (click_events by utm_content). */
export async function contentPerformance(ctx: Pick<ServiceContext, "db" | "orgId">, opts: { since: Date; includeDemo: boolean; productId?: string }): Promise<ContentPerformanceRow[]> {
  const demo = opts.includeDemo ? sql`true` : sql`c.is_demo = false`;
  const product = opts.productId ? sql`and c.product_id = ${opts.productId}` : sql``;
  const res = await ctx.db.execute(sql`
    select c.id, c.title, c.hook, c.angle, c.platform, c.content_type as "contentType", c.product_id as "productId", p.title as "productTitle",
           c.status, c.utm_content as "utmContent",
           coalesce(m.views, 0)::int as views,
           coalesce(m.engagements, 0)::int as engagements,
           coalesce(m.clicks, 0)::int as "platformClicks",
           coalesce(e.visits, 0)::int as "siteVisits",
           coalesce(e.aff, 0)::int as "affiliateClicks",
           coalesce(cv.n, 0)::int as conversions
    from content c
    left join products p on p.id = c.product_id
    left join (
      select content_id, sum(views) as views, sum(likes + comments + shares + saves) as engagements, sum(clicks) as clicks
      from content_metrics where date >= ${opts.since.toISOString().slice(0, 10)} group by content_id
    ) m on m.content_id = c.id
    left join (
      select product_id, utm_content,
             count(*) filter (where event_type = 'PAGE_VIEW') as visits,
             count(*) filter (where event_type = 'AFFILIATE_CLICK') as aff
      from click_events where organization_id = ${ctx.orgId} and created_at >= ${opts.since} and is_bot = false and utm_content is not null
      group by product_id, utm_content
    ) e on e.product_id = c.product_id and e.utm_content = c.utm_content
    left join (
      select product_id, utm_content, count(*) as n from conversion_events
      where organization_id = ${ctx.orgId} and occurred_at >= ${opts.since} and utm_content is not null group by product_id, utm_content
    ) cv on cv.product_id = c.product_id and cv.utm_content = c.utm_content
    where c.organization_id = ${ctx.orgId} and ${demo} ${product}
  `);
  return (res.rows as unknown as Omit<ContentPerformanceRow, "engagementRate" | "ctr">[]).map((r) => ({
    ...r,
    engagementRate: r.views ? r.engagements / r.views : 0,
    ctr: r.views ? Math.max(r.platformClicks, r.siteVisits) / r.views : 0,
  }));
}

/** Winning hook / format / platform / angle from performance data. */
export function summarizeWinners(rows: ContentPerformanceRow[]) {
  const withData = rows.filter((r) => r.views >= 100 || r.siteVisits >= 20);
  const best = <K extends keyof ContentPerformanceRow>(key: K) => {
    const groups = new Map<string, { views: number; visits: number; conv: number; n: number }>();
    for (const r of withData) {
      const k = String(r[key] ?? "—");
      const g = groups.get(k) ?? { views: 0, visits: 0, conv: 0, n: 0 };
      g.views += r.views;
      g.visits += Math.max(r.siteVisits, r.platformClicks);
      g.conv += r.conversions;
      g.n++;
      groups.set(k, g);
    }
    return [...groups.entries()]
      .map(([k, g]) => ({ key: k, ctr: g.views ? g.visits / g.views : 0, conversions: g.conv, items: g.n, visits: g.visits }))
      .sort((a, b) => b.ctr - a.ctr || b.conversions - a.conversions)[0] ?? null;
  };
  const topItem = [...withData].sort((a, b) => b.ctr - a.ctr || b.conversions - a.conversions)[0] ?? null;
  return { hook: topItem ? { key: topItem.hook ?? topItem.title, ctr: topItem.ctr, contentId: topItem.id, productId: topItem.productId, angle: topItem.angle } : null, format: best("contentType"), platform: best("platform"), angle: best("angle"), product: best("productTitle"), sample: withData.length };
}

export async function exportContentPackage(ctx: Pick<ServiceContext, "db" | "orgId">, ids: string[], format: "json" | "csv" | "markdown") {
  if (!ids.length) return "";
  const rows = await ctx.db.select().from(content).where(and(eq(content.organizationId, ctx.orgId), inArray(content.id, ids.slice(0, 500))));
  const withUrls = await Promise.all(rows.map(async (r) => ({ ...r, trackingUrl: await trackingUrlFor(ctx, r) })));
  if (format === "json") return JSON.stringify(withUrls.map(({ organizationId: _o, ...r }) => r), null, 2);
  if (format === "csv") {
    return toCsv(
      withUrls.map((r) => ({ platform: r.platform, type: r.contentType, angle: r.angle, title: r.title, hook: r.hook, caption: r.caption, cta: r.cta, hashtags: r.hashtags.join(" "), scheduled_at: r.scheduledAt?.toISOString() ?? "", tracking_url: r.trackingUrl, disclosure: r.sponsoredDisclosure ?? "" })),
    );
  }
  return withUrls
    .map((r) =>
      [
        `## ${r.title}`,
        `**Platform:** ${r.platform} · **Type:** ${r.contentType} · **Angle:** ${r.angle ?? "—"}`,
        r.hook ? `**Hook:** ${r.hook}` : "",
        r.script?.length ? r.script.map((b) => `- **${b.label}** (${b.from}–${b.to}s): ${b.line} _Visual: ${b.visual}_`).join("\n") : "",
        r.body ? r.body : "",
        `**Caption:** ${r.caption ?? ""}`,
        `**CTA:** ${r.cta ?? ""}`,
        r.hashtags.length ? `**Hashtags:** ${r.hashtags.join(" ")}` : "",
        r.trackingUrl ? `**Tracked link:** ${r.trackingUrl}` : "",
        r.sponsoredDisclosure ? `> ${r.sponsoredDisclosure}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    )
    .join("\n\n---\n\n");
}
