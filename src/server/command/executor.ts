// Translates parsed commands into internal actions: queries, background jobs, explanations.

import { and, desc, eq, inArray, lte, gte } from "drizzle-orm";
import { can } from "@/lib/rbac";
import { formatPercent, round } from "@/lib/utils";
import type { ServiceContext } from "../context";
import { productDecisions, products, productTests } from "../db/schema";
import { IntentSchema, type CommandIntent, type ParsedIntent } from "../ai/schemas";
import { aiStructured } from "../ai/service";
import { enqueueJob } from "../jobs/queue";
import { getSetting } from "../settings";
import { findProductByQuery, listProducts } from "../services/products";
import { latestScore } from "../services/scoring";
import { leaderboard, productStats, rangeForDays } from "../services/analytics";
import { audit } from "../audit";
import { COMMAND_EXAMPLES, parseCommand } from "./parser";

export interface CommandProduct {
  id: string;
  title: string;
  slug: string;
  score: number | null;
  price: number | null;
  currency: string;
  status: string;
  note?: string;
  isDemo: boolean;
}

export interface CommandResult {
  intent: CommandIntent;
  engine: "RULES" | "AI" | "TEMPLATE";
  reply: string;
  products?: CommandProduct[];
  job?: { id: number; type: string; deduped: boolean };
  links?: Array<{ label: string; href: string }>;
}

const toCard = (p: typeof products.$inferSelect, note?: string): CommandProduct => ({ id: p.id, title: p.title, slug: p.slug, score: p.overallScore, price: p.sellingPrice, currency: p.currency, status: p.status, note, isDemo: p.isDemo });

async function resolve(ctx: ServiceContext, parsed: ParsedIntent) {
  if (!parsed.productQuery) return null;
  return findProductByQuery(ctx, parsed.productQuery);
}

function needsProduct(parsed: ParsedIntent, what: string): CommandResult {
  return { intent: parsed.intent, engine: "RULES", reply: parsed.productQuery ? `I couldn't find a product matching “${parsed.productQuery}”. Try the exact product name.` : `Which product? e.g. “${what} for Silicone Stretch Lids”.` };
}

export async function executeCommand(ctx: ServiceContext, input: string): Promise<CommandResult> {
  let parsed = parseCommand(input);
  let engine: CommandResult["engine"] = "RULES";
  if (parsed.intent === "UNKNOWN") {
    const r = await aiStructured(ctx, {
      task: "command",
      schema: IntentSchema,
      schemaName: "command_intent",
      system: "Classify an e-commerce operator's command into one intent and extract parameters. productQuery = the product name mentioned, if any.",
      prompt: input.slice(0, 500),
      fallback: () => parsed,
      cache: true,
    });
    if (r.method === "AI") {
      parsed = r.data;
      engine = "AI";
    }
  }
  await audit(ctx, "command.run", { type: "command" }, { input: input.slice(0, 200), intent: parsed.intent });
  const canAct = can(ctx.role, "agents:run");
  const limit = parsed.limit ?? 10;

  switch (parsed.intent) {
    case "HELP":
    case "UNKNOWN":
      return {
        intent: parsed.intent,
        engine,
        reply: `${parsed.intent === "UNKNOWN" ? "I didn't understand that yet. " : ""}Here's what I can do:\n${COMMAND_EXAMPLES.map((e) => `• ${e}`).join("\n")}`,
      };

    case "FIND_PRODUCTS":
    case "TOP_PRODUCTS": {
      const { items } = await listProducts(ctx, { status: ["DISCOVERED", "RESEARCHING", "APPROVED", "TESTING", "WINNER", "SCALING"], maxPrice: parsed.maxPrice ?? undefined, limit: 100 });
      let ranked = items;
      if (parsed.traits.includes("content")) ranked = [...ranked].sort((a, b) => (b.contentScore ?? 0) - (a.contentScore ?? 0) || (b.overallScore ?? 0) - (a.overallScore ?? 0));
      else if (parsed.traits.includes("margin")) ranked = [...ranked].sort((a, b) => (b.estimatedMargin ?? 0) - (a.estimatedMargin ?? 0));
      else if (parsed.traits.includes("problem")) ranked = [...ranked].sort((a, b) => (b.problemScore ?? 0) - (a.problemScore ?? 0));
      const top = ranked.slice(0, limit);
      const criteria = [parsed.maxPrice ? `under ${parsed.maxPrice}` : null, parsed.traits.includes("content") ? "ranked by short-form content potential" : null].filter(Boolean).join(", ");
      return {
        intent: parsed.intent,
        engine,
        reply: top.length ? `${top.length} product${top.length === 1 ? "" : "s"}${criteria ? ` (${criteria})` : ""}, best first.` : "No products match yet — run discovery or import a CSV.",
        products: top.map((p) => toCard(p, parsed.traits.includes("content") ? `Content potential ${round(p.contentScore ?? 0)}` : p.estimatedMargin !== null ? `Margin ${Math.round(p.estimatedMargin)}%` : undefined)),
        links: [{ label: "Open product database", href: "/admin/products" }],
      };
    }

    case "RISING_DEMAND_LOW_COMPETITION": {
      const rows = await ctx.db
        .select()
        .from(products)
        .where(and(eq(products.organizationId, ctx.orgId), gte(products.trendScore, 60), lte(products.competitionScore, 60), inArray(products.status, ["DISCOVERED", "RESEARCHING", "APPROVED", "TESTING", "WINNER"])))
        .orderBy(desc(products.trendScore))
        .limit(limit);
      return {
        intent: parsed.intent,
        engine,
        reply: rows.length ? `${rows.length} products with a trend index ≥ 60 and competition ≤ 60. Check each trend's provenance before acting.` : "Nothing currently combines rising interest with low competition.",
        products: rows.map((p) => toCard(p, `Trend ${round(p.trendScore ?? 0)} [${p.fieldProvenance?.trendScore?.p ?? "?"}] · Competition ${round(p.competitionScore ?? 0)}`)),
      };
    }

    case "HIGH_TRAFFIC_LOW_CONVERSION": {
      const t = await getSetting(ctx, "testing.thresholds");
      const board = (await leaderboard(ctx, rangeForDays(14), 200)).filter((r) => r.views >= Math.min(100, t.minPageViews) && r.conversionRate < t.winner.minConversionRate);
      const rows = board.sort((a, b) => b.views - a.views).slice(0, limit);
      return {
        intent: parsed.intent,
        engine,
        reply: rows.length ? `${rows.length} products get traffic but convert below ${formatPercent(t.winner.minConversionRate, 1)} (last 14 days). Candidates for page/offer optimisation.` : "No products with meaningful traffic are under-converting right now.",
        products: rows.map((r) => ({ id: r.productId, title: r.title, slug: r.slug, score: r.score, price: null, currency: "USD", status: r.status, isDemo: r.isDemo, note: `${r.views} views · CTR ${formatPercent(r.ctr)} · conv ${formatPercent(r.conversionRate, 2)}` })),
      };
    }

    case "WHICH_TO_SCALE":
    case "WHICH_TO_KILL": {
      const wanted = parsed.intent === "WHICH_TO_SCALE" ? "SCALE" : "KILL";
      const rows = await ctx.db
        .select({ d: productDecisions, p: products })
        .from(productDecisions)
        .innerJoin(products, eq(products.id, productDecisions.productId))
        .where(and(eq(productDecisions.organizationId, ctx.orgId), eq(productDecisions.decision, wanted)))
        .orderBy(desc(productDecisions.createdAt))
        .limit(50);
      const seen = new Set<string>();
      const unique = rows.filter((r) => (seen.has(r.p.id) ? false : (seen.add(r.p.id), true))).filter((r) => (wanted === "KILL" ? r.p.status !== "KILLED" : true));
      let cards = unique.slice(0, limit).map((r) => toCard(r.p, r.d.reasons[0]));
      if (!cards.length && wanted === "SCALE") {
        const winners = await ctx.db.select().from(products).where(and(eq(products.organizationId, ctx.orgId), eq(products.status, "WINNER"))).limit(limit);
        cards = winners.map((p) => toCard(p, "Classified WINNER"));
      }
      return {
        intent: parsed.intent,
        engine,
        reply: cards.length
          ? `${wanted === "SCALE" ? "Scale" : "Kill"} candidates from the decision engine (latest test evaluations):`
          : `No ${wanted === "SCALE" ? "scale" : "kill"} decisions yet — tests need data. Run “Evaluate tests” from the Testing page.`,
        products: cards,
        links: [{ label: "Testing dashboard", href: "/admin/products/testing" }],
      };
    }

    case "EXPLAIN_PRODUCT": {
      const p = await resolve(ctx, parsed);
      if (!p) return needsProduct(parsed, "Why did … fail");
      const [test] = await ctx.db.select().from(productTests).where(eq(productTests.productId, p.id)).orderBy(desc(productTests.startedAt)).limit(1);
      const [decision] = await ctx.db.select().from(productDecisions).where(eq(productDecisions.productId, p.id)).orderBy(desc(productDecisions.createdAt)).limit(1);
      const score = await latestScore(ctx, p.id);
      const stats = await productStats(ctx, p.id, test?.startedAt ?? new Date(Date.now() - 30 * 86400_000));
      const weak = Object.entries(score?.factors ?? {})
        .filter(([, f]) => f.score <= 45 && f.provenance !== "MISSING")
        .map(([k, f]) => `${k} ${f.score} (${f.note})`);
      const lines = [
        `${p.title} — status ${p.status}${p.isDemo ? " (DEMO data)" : ""}.`,
        test ? `Test verdict: ${test.verdict ?? "not evaluated"}${test.decision ? ` → ${test.decision}` : ""}.` : "No test has been run for this product.",
        ...(test?.reasons?.length ? test.reasons.map((r) => `• ${r}`) : []),
        `Traffic since test start: ${stats.pageViews} views, ${stats.affiliateClicks + stats.productClicks} clicks, ${stats.conversions} conversions.`,
        weak.length ? `Weak score factors: ${weak.join("; ")}.` : "",
        score?.warnings?.length ? `Warnings: ${score.warnings.slice(0, 4).join("; ")}.` : "",
        decision && !test ? `Latest decision: ${decision.decision} — ${decision.reasons.join(" ")}` : "",
      ].filter(Boolean);
      return { intent: parsed.intent, engine, reply: lines.join("\n"), products: [toCard(p)], links: [{ label: "Open command center", href: `/admin/products/${p.id}` }] };
    }

    case "CREATE_LANDING_PAGE":
    case "GENERATE_CONTENT":
    case "LAUNCH_TEST": {
      if (!canAct) return { intent: parsed.intent, engine, reply: "Your role (viewer) can't start agents. Ask an operator or admin." };
      const p = await resolve(ctx, parsed);
      if (!p) return needsProduct(parsed, parsed.intent === "GENERATE_CONTENT" ? "Generate 10 TikTok ideas" : parsed.intent === "LAUNCH_TEST" ? "Launch a test" : "Create a landing page");
      const type = parsed.intent === "CREATE_LANDING_PAGE" ? "landing_page_generation" : parsed.intent === "GENERATE_CONTENT" ? "content_generation" : "launch_test_kit";
      const contentType = { TIKTOK: "TIKTOK_VIDEO", INSTAGRAM: "INSTAGRAM_REEL", YOUTUBE: "YOUTUBE_SHORT", PINTEREST: "PINTEREST_PIN", FACEBOOK: "PROBLEM_SOLUTION_POST", X: "STATIC_POST" }[parsed.platform ?? "TIKTOK"] ?? "TIKTOK_VIDEO";
      const payload = parsed.intent === "GENERATE_CONTENT" ? { productId: p.id, platform: parsed.platform ?? "TIKTOK", contentType, count: Math.min(parsed.limit ?? 10, 30) } : { productId: p.id };
      const job = await enqueueJob(ctx.db, { type, orgId: ctx.orgId, payload, trigger: "API", dedupeKey: `${type}:${p.id}:${parsed.limit ?? ""}:${parsed.platform ?? ""}` });
      const what = parsed.intent === "CREATE_LANDING_PAGE" ? "Building a landing page" : parsed.intent === "GENERATE_CONTENT" ? `Generating ${payload.count ?? 10} ${(parsed.platform ?? "TIKTOK").toLowerCase()} concepts` : "Generating the full launch kit (research → score → landing page → 10 concepts → tracking)";
      return { intent: parsed.intent, engine, reply: `${what} for ${p.title}. ${job.deduped ? "An identical job is already running." : "Queued as a background job."}`, products: [toCard(p)], job: { id: job.id, type, deduped: job.deduped }, links: [{ label: "Open product", href: `/admin/products/${p.id}` }] };
    }

    case "RUN_DISCOVERY": {
      if (!canAct) return { intent: parsed.intent, engine, reply: "Your role can't start discovery." };
      const job = await enqueueJob(ctx.db, { type: "product_discovery", orgId: ctx.orgId, trigger: "API", dedupeKey: "discovery:manual" });
      return { intent: parsed.intent, engine, reply: "Discovery queued across every configured source.", job: { id: job.id, type: "product_discovery", deduped: job.deduped }, links: [{ label: "Discovery", href: "/admin/products/discover" }] };
    }
  }
}
