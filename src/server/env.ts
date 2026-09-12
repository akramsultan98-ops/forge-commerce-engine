import { z } from "zod";

if (typeof window !== "undefined") {
  // Hard guard: server modules (and therefore secrets) must never be bundled for the browser.
  throw new Error("src/server/* was imported from browser code. Secrets must stay server-side.");
}

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DEMO_MODE: bool.default(true),
  /** Ephemeral previews (embedded PGlite, e.g. pglite://memory on Vercel): load the labelled demo data at boot. Requires DEMO_MODE. */
  DEMO_SEED_ON_BOOT: bool.default(false),
  DATABASE_URL: z.string().min(1).default("pglite://./.data/pglite"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  AUTH_SECRET: z.string().default(""),
  ENCRYPTION_KEY: z.string().default(""),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  /** Comma-separated IPs / CIDR blocks / presets (loopback, private, linklocal) whose X-Forwarded-For is honoured. Empty = none. */
  TRUSTED_PROXIES: z.string().default(""),
  JOB_RUNNER: z.enum(["embedded", "external", "off"]).default("embedded"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),

  AI_DEFAULT_PROVIDER: z.string().default("anthropic"),
  ANTHROPIC_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  GOOGLE_AI_API_KEY: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  LOCAL_AI_BASE_URL: z.string().default(""),
  LOCAL_AI_MODEL: z.string().default(""),

  SHOPIFY_CLIENT_ID: z.string().default(""),
  SHOPIFY_CLIENT_SECRET: z.string().default(""),
  SHOPIFY_SCOPES: z.string().default("read_products,write_products,read_orders,read_inventory"),
  SHOPIFY_API_VERSION: z.string().default("2026-07"),
  SHOPIFY_SHOP_DOMAIN: z.string().default(""),
  SHOPIFY_ACCESS_TOKEN: z.string().default(""),
  /** Store-level webhook signing secret (Shopify admin → Settings → Notifications → Webhooks) for single-token setups. */
  SHOPIFY_WEBHOOK_SECRET: z.string().default(""),

  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  EMAIL_PROVIDER: z.string().default("resend"),
  EMAIL_PROVIDER_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("FORGE <alerts@example.com>"),
  ALERT_EMAIL_TO: z.string().default(""),

  AFFILIATE_API_KEYS: z.string().default("{}"),
  AFFILIATE_POSTBACK_SECRET: z.string().default(""),

  CJ_API_KEY: z.string().default(""),
  ALIEXPRESS_APP_KEY: z.string().default(""),
  ALIEXPRESS_APP_SECRET: z.string().default(""),
  AMAZON_PAAPI_ACCESS_KEY: z.string().default(""),
  AMAZON_PAAPI_SECRET_KEY: z.string().default(""),
  AMAZON_PARTNER_TAG: z.string().default(""),
  TRENDS_WIKIPEDIA_ENABLED: bool.default(true),

  TIKTOK_CLIENT_KEY: z.string().default(""),
  TIKTOK_CLIENT_SECRET: z.string().default(""),
  META_APP_ID: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  YOUTUBE_CLIENT_ID: z.string().default(""),
  YOUTUBE_CLIENT_SECRET: z.string().default(""),
  FACEBOOK_PAGE_ID: z.string().default(""),
  FACEBOOK_PAGE_ACCESS_TOKEN: z.string().default(""),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().default(""),
  PINTEREST_ACCESS_TOKEN: z.string().default(""),
  PINTEREST_BOARD_ID: z.string().default(""),
  X_USER_ACCESS_TOKEN: z.string().default(""),

  ANALYTICS_KEYS: z.string().default("{}"),
  ERROR_TRACKING_DSN: z.string().default(""),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DEFAULT_LOCALE: z.enum(["en", "ar"]).default("en"),
  DEFAULT_CURRENCY: z.string().default("USD"),
  DEFAULT_MARKET: z.string().default("US"),
  IMAGE_REMOTE_HOSTS: z.string().default(""),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parsed, validated environment. Empty strings are treated as "not configured". */
export function env(): Env {
  if (cached) return cached;
  const raw: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) raw[k] = v === "" ? undefined : v;
  // On Vercel, APP_URL defaults to the deployment's own https URL: the stable branch URL for
  // previews, the production URL for production. An explicit APP_URL always wins.
  if (!raw.APP_URL && raw.VERCEL === "1") {
    const host = raw.VERCEL_ENV === "production" ? raw.VERCEL_PROJECT_PRODUCTION_URL : (raw.VERCEL_BRANCH_URL ?? raw.VERCEL_URL);
    if (host) raw.APP_URL = `https://${host}`;
  }
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === "production") {
    const weak = (s: string) => s.length < 32 || s.startsWith("replace-with");
    if (weak(e.AUTH_SECRET)) throw new Error("AUTH_SECRET must be set to a strong random value in production.");
    if (weak(e.ENCRYPTION_KEY)) throw new Error("ENCRYPTION_KEY must be set to a strong random value in production.");
  }
  cached = e;
  return e;
}

/** For tests: drop the cached env so changes to process.env are re-read. */
export function resetEnvCache() {
  cached = null;
}

export const isDemoMode = () => env().DEMO_MODE;
