import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { CURRENCIES, MARKETS } from "@/lib/constants";
import { DEFAULT_WEIGHTS, SCORING_FACTORS } from "@/domain/scoring";
import { DEFAULT_TEST_THRESHOLDS } from "@/domain/testing";
import { DEFAULT_RATES } from "@/domain/money";
import type { ServiceContext } from "./context";
import { settings } from "./db/schema";
import { audit } from "./audit";
import { ValidationError } from "./errors";

const weight = z.number().min(0).max(100);

export const AI_TASKS = [
  "research",
  "scoring_assist",
  "copywriting",
  "landing_page",
  "content",
  "recommendations",
  "command",
  "report",
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const SETTINGS = {
  "scoring.weights": {
    schema: z.object(Object.fromEntries(SCORING_FACTORS.map((f) => [f, weight])) as Record<(typeof SCORING_FACTORS)[number], typeof weight>),
    defaults: DEFAULT_WEIGHTS,
  },
  "testing.thresholds": {
    schema: z.object({
      minDays: z.number().int().min(1).max(90),
      maxDays: z.number().int().min(1).max(180),
      minPageViews: z.number().int().min(10),
      winner: z.object({ minAffiliateCtr: z.number().min(0).max(1), minConversionRate: z.number().min(0).max(1), minRoi: z.number().min(-1).max(50) }),
      failure: z.object({ maxAffiliateCtr: z.number().min(0).max(1), maxConversionRate: z.number().min(0).max(1) }),
      engagement: z.object({ strongRate: z.number().min(0).max(1) }),
    }),
    defaults: DEFAULT_TEST_THRESHOLDS,
  },
  "ai.routing": {
    schema: z.object({
      provider: z.enum(["anthropic", "openai", "google", "openrouter", "local", "template"]),
      fastModel: z.string().min(1).max(120),
      strongModel: z.string().min(1).max(120),
      taskTiers: z.record(z.string(), z.enum(["fast", "strong"])),
      monthlyBudgetUsd: z.number().min(0).max(100000),
      cacheTtlHours: z.number().min(0).max(24 * 90),
    }),
    defaults: {
      provider: "anthropic" as const,
      fastModel: "claude-haiku-4-5",
      strongModel: "claude-opus-5",
      taskTiers: {
        research: "strong",
        scoring_assist: "fast",
        copywriting: "fast",
        landing_page: "fast",
        content: "fast",
        recommendations: "strong",
        command: "fast",
        report: "strong",
      } as Record<string, "fast" | "strong">,
      monthlyBudgetUsd: 50,
      cacheTtlHours: 24 * 7,
    },
  },
  currency: {
    schema: z.object({
      display: z.enum(CURRENCIES),
      rates: z.record(z.string(), z.number().positive()),
      ratesUpdatedAt: z.string().nullable(),
    }),
    defaults: { display: "USD" as (typeof CURRENCIES)[number], rates: DEFAULT_RATES as Record<string, number>, ratesUpdatedAt: null as string | null },
  },
  markets: {
    schema: z.object({ primary: z.string(), enabled: z.array(z.string()).min(1) }),
    defaults: { primary: "US", enabled: MARKETS.map((m) => m.code) as string[] },
  },
  notifications: {
    schema: z.object({
      email: z.boolean(),
      telegram: z.boolean(),
      emailTo: z.string().email().or(z.literal("")),
      trafficSpikeMultiplier: z.number().min(1.2).max(20),
    }),
    defaults: { email: false, telegram: false, emailTo: "", trafficSpikeMultiplier: 2.5 },
  },
  discovery: {
    schema: z.object({
      maxPriceUsd: z.number().min(1).max(10000),
      minMarginPct: z.number().min(0).max(95),
      excludeHighRisk: z.boolean(),
      defaultBusinessModel: z.enum(["AFFILIATE", "DROPSHIPPING", "SHOPIFY", "LANDING_PAGE"]),
      autoScoreNewProducts: z.boolean(),
      minScoreToApprove: z.number().min(0).max(100),
    }),
    defaults: { maxPriceUsd: 80, minMarginPct: 30, excludeHighRisk: true, defaultBusinessModel: "AFFILIATE" as const, autoScoreNewProducts: true, minScoreToApprove: 70 },
  },
  storefront: {
    schema: z.object({
      name: z.string().min(1).max(60),
      contactEmail: z.string().email().or(z.literal("")),
      affiliateDisclosure: z.string().min(10).max(1000),
      returnsSummary: z.string().max(1000),
      shippingSummary: z.string().max(1000),
    }),
    defaults: {
      name: "FORGE",
      contactEmail: "",
      affiliateDisclosure:
        "Some links on FORGE are affiliate links. If you buy through them we may earn a commission, at no extra cost to you. It never changes which products we feature or what we say about them.",
      returnsSummary: "Returns are handled by the merchant you buy from. Their return window and conditions apply — check the merchant's policy before ordering.",
      shippingSummary: "Shipping times and costs are set by the merchant and shown at checkout. Estimates on FORGE come from supplier data and may change.",
    },
  },
  onboarding: {
    schema: z.object({ firstRunAt: z.string().nullable(), firstRunJobId: z.number().nullable() }),
    defaults: { firstRunAt: null as string | null, firstRunJobId: null as number | null },
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

function merge<T>(defaults: T, stored: unknown): T {
  if (stored && typeof stored === "object" && !Array.isArray(stored) && defaults && typeof defaults === "object") {
    const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
    for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
      const d = (defaults as Record<string, unknown>)[k];
      out[k] = d && typeof d === "object" && !Array.isArray(d) ? merge(d, v) : v;
    }
    return out as T;
  }
  return defaults;
}

export async function getSetting<K extends SettingKey>(ctx: Pick<ServiceContext, "db" | "orgId">, key: K): Promise<SettingValue<K>> {
  const def = SETTINGS[key];
  const [row] = await ctx.db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.organizationId, ctx.orgId), eq(settings.key, key)))
    .limit(1);
  const merged = merge(def.defaults, row?.value);
  const parsed = def.schema.safeParse(merged);
  return (parsed.success ? parsed.data : def.defaults) as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(ctx: ServiceContext, key: K, value: unknown): Promise<SettingValue<K>> {
  const def = SETTINGS[key];
  const current = await getSetting(ctx, key);
  const parsed = def.schema.safeParse(merge(current, value));
  if (!parsed.success) throw new ValidationError(`Invalid value for setting ${key}`, parsed.error.issues);
  if (key === "testing.thresholds") {
    const t = parsed.data as typeof DEFAULT_TEST_THRESHOLDS;
    if (t.minDays > t.maxDays) throw new ValidationError("minDays must be ≤ maxDays");
  }
  if (key === "scoring.weights") {
    const total = Object.values(parsed.data as Record<string, number>).reduce((s, n) => s + n, 0);
    if (total <= 0) throw new ValidationError("At least one scoring weight must be greater than zero");
  }
  await ctx.db
    .insert(settings)
    .values({ organizationId: ctx.orgId, key, value: parsed.data, updatedBy: ctx.userId })
    .onConflictDoUpdate({ target: [settings.organizationId, settings.key], set: { value: parsed.data, updatedBy: ctx.userId, updatedAt: new Date() } });
  await audit(ctx, "settings.update", { type: "setting", id: key }, { key });
  return parsed.data as SettingValue<K>;
}
