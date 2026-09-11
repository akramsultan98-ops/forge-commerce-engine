// Editorial / discovery engine: article ideas from the catalog, drafted by AI or the template engine.

import { and, desc, eq, inArray } from "drizzle-orm";
import { slugify } from "@/lib/utils";
import { assertCan, type ServiceContext } from "../context";
import type { Database } from "../db/client";
import { articles, categories, products } from "../db/schema";
import { buildBrief } from "../ai/brief";
import { ArticleSchema } from "../ai/schemas";
import { aiStructured } from "../ai/service";
import { templateArticle } from "../ai/templates";
import { audit } from "../audit";
import { NotFoundError } from "../errors";
import { briefToPrompt } from "../ai/brief";

export async function listArticles(ctx: Pick<ServiceContext, "db" | "orgId">, opts: { status?: "IDEA" | "DRAFT" | "PUBLISHED" } = {}) {
  return ctx.db
    .select()
    .from(articles)
    .where(and(eq(articles.organizationId, ctx.orgId), opts.status ? eq(articles.status, opts.status) : undefined))
    .orderBy(desc(articles.updatedAt));
}

export async function getPublishedArticle(db: Database, orgId: string, slug: string) {
  const [row] = await db.select().from(articles).where(and(eq(articles.organizationId, orgId), eq(articles.slug, slug), eq(articles.status, "PUBLISHED"))).limit(1);
  return row ?? null;
}

/** Proposes article ideas per category from the current catalog (never duplicates an existing slug). */
export async function generateArticleIdeas(ctx: ServiceContext) {
  assertCan(ctx, "content:write");
  const cats = await ctx.db.select().from(categories).where(eq(categories.organizationId, ctx.orgId));
  const existing = new Set((await ctx.db.select({ slug: articles.slug }).from(articles).where(eq(articles.organizationId, ctx.orgId))).map((r) => r.slug));
  let created = 0;
  for (const c of cats) {
    const items = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.categoryId, c.id), inArray(products.status, ["APPROVED", "TESTING", "WINNER", "SCALING"])))
      .orderBy(desc(products.overallScore))
      .limit(7);
    if (items.length < 2) continue;
    const ideas: Array<{ type: "LISTICLE" | "BEST_FOR" | "VERSUS"; title: string; ids: string[] }> = [
      { type: "LISTICLE", title: `${items.length} products that solve small ${c.name.toLowerCase()} annoyances`, ids: items.map((i) => i.id) },
      { type: "BEST_FOR", title: `Best ${c.name.toLowerCase()} upgrades under $50`, ids: items.filter((i) => (i.sellingPrice ?? 999) <= 50).map((i) => i.id) },
      { type: "VERSUS", title: `${items[0].title.split(/\s[–—-]\s|\(/)[0].trim()} vs ${items[1].title.split(/\s[–—-]\s|\(/)[0].trim()}`, ids: [items[0].id, items[1].id] },
    ];
    for (const idea of ideas) {
      if (idea.ids.length < 2) continue;
      const slug = slugify(idea.title, 70);
      if (existing.has(slug)) continue;
      existing.add(slug);
      await ctx.db.insert(articles).values({ organizationId: ctx.orgId, slug, type: idea.type, status: "IDEA", title: idea.title, productIds: idea.ids, isDemo: items.every((i) => i.isDemo) });
      created++;
    }
  }
  return { created };
}

export async function writeArticle(ctx: ServiceContext, id: string) {
  assertCan(ctx, "content:write");
  const [a] = await ctx.db.select().from(articles).where(and(eq(articles.id, id), eq(articles.organizationId, ctx.orgId))).limit(1);
  if (!a) throw new NotFoundError("Article");
  const rows = a.productIds.length
    ? await ctx.db.select({ p: products, c: categories }).from(products).leftJoin(categories, eq(categories.id, products.categoryId)).where(inArray(products.id, a.productIds))
    : [];
  const briefs = rows.map((r) => buildBrief(r.p, r.c));
  const topic = rows[0]?.c?.name ?? "everyday life";
  const kind = a.type;
  const result = await aiStructured(ctx, {
    task: "content",
    schema: ArticleSchema,
    schemaName: "article",
    system: "Write a genuinely useful, non-spammy editorial article. Every product mention must be justified by the fact sheets. Include honest watch-outs. Use 'product' blocks (with productId) where a product card should appear.",
    prompt: `Article type: ${kind}\nWorking title: ${a.title}\n\nProducts:\n${briefs.map((b) => `[productId=${b.id}]\n${briefToPrompt(b)}`).join("\n\n")}`,
    fallback: () => templateArticle(kind, briefs, topic),
  });
  const d = result.data;
  await ctx.db
    .update(articles)
    .set({ title: d.title, excerpt: d.excerpt, seoTitle: d.seoTitle, metaDescription: d.metaDescription, body: { blocks: d.blocks.map((b) => ({ ...b, productId: b.productId && a.productIds.includes(b.productId) ? b.productId : undefined })) }, status: "DRAFT", generationMethod: result.method })
    .where(eq(articles.id, id));
  await audit(ctx, "article.write", { type: "article", id }, { method: result.method });
  return result;
}

export async function setArticleStatus(ctx: ServiceContext, id: string, status: "DRAFT" | "PUBLISHED") {
  assertCan(ctx, "content:write");
  await ctx.db.update(articles).set({ status, publishedAt: status === "PUBLISHED" ? new Date() : null }).where(and(eq(articles.id, id), eq(articles.organizationId, ctx.orgId)));
}
