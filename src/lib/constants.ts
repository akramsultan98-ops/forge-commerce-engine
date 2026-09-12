// Client-safe domain constants. The database enums are generated from these tuples,
// so this file is the single source of truth for every status / type vocabulary.

/**
 * `automation` is a machine role for API keys (n8n and other workflows): it can discover, ingest,
 * refresh, score and submit network listings, but never approve or publish them. People get one of
 * HUMAN_ROLES.
 */
export const USER_ROLES = ["admin", "operator", "viewer", "automation"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const HUMAN_ROLES = ["admin", "operator", "viewer"] as const satisfies readonly UserRole[];

export const PRODUCT_STATUSES = [
  "DISCOVERED",
  "RESEARCHING",
  "APPROVED",
  "TESTING",
  "WINNER",
  "SCALING",
  "PAUSED",
  "KILLED",
  "ARCHIVED",
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Statuses whose products may appear on the public storefront. */
export const PUBLIC_PRODUCT_STATUSES: ProductStatus[] = ["APPROVED", "TESTING", "WINNER", "SCALING"];

export const BUSINESS_MODELS = ["AFFILIATE", "DROPSHIPPING", "SHOPIFY", "LANDING_PAGE"] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];

/**
 * Data provenance — every important metric records where it came from.
 * REAL: fetched from an official API / verified feed. ESTIMATED: derived by a formula from other data.
 * AI_INFERENCE: an AI model's judgement. MANUAL: typed in by an operator. DEMO: seed/demo data.
 */
export const PROVENANCES = ["REAL", "ESTIMATED", "AI_INFERENCE", "MANUAL", "DEMO"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const CONTENT_STATUSES = [
  "IDEA",
  "SCRIPTED",
  "ASSET_READY",
  "SCHEDULED",
  "PUBLISHED",
  "ANALYZING",
  "WINNER",
  "REJECTED",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "PINTEREST", "FACEBOOK", "X", "EMAIL", "BLOG", "WEB", "OTHER"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const SOCIAL_PLATFORMS: Platform[] = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "PINTEREST", "FACEBOOK", "X"];

export const CONTENT_TYPES = [
  "TIKTOK_VIDEO",
  "INSTAGRAM_REEL",
  "YOUTUBE_SHORT",
  "PINTEREST_PIN",
  "STATIC_POST",
  "CAROUSEL",
  "EDUCATIONAL_POST",
  "PROBLEM_SOLUTION_POST",
  "AD_CONCEPT",
  "EMAIL",
  "ARTICLE",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_ANGLES = [
  "CURIOSITY",
  "PROBLEM_SOLUTION",
  "BEFORE_AFTER",
  "POV",
  "UNEXPECTED_USE",
  "COMPARISON",
  "EXPERIMENT",
  "CHALLENGE",
  "REACTION",
  "EDUCATIONAL",
  "UGC",
  "UNBOXING",
  "REVIEW",
  "MYTH_BUSTING",
] as const;
export type ContentAngle = (typeof CONTENT_ANGLES)[number];

export const GENERATION_METHODS = ["AI", "TEMPLATE", "MANUAL"] as const;
export type GenerationMethod = (typeof GENERATION_METHODS)[number];

export const INTEGRATION_STATUSES = ["NOT_CONFIGURED", "CONNECTED", "ERROR", "DEMO", "DISABLED"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const LINK_STATUSES = ["UNCHECKED", "ACTIVE", "BROKEN", "PAUSED"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const DECISIONS = ["SCALE", "TEST_MORE", "OPTIMIZE", "CONTENT_MORE", "PAUSE", "KILL"] as const;
export type Decision = (typeof DECISIONS)[number];

export const TEST_VERDICTS = ["WINNER", "PROMISING", "FAILURE", "INSUFFICIENT_DATA"] as const;
export type TestVerdict = (typeof TEST_VERDICTS)[number];

export const PAGE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

export const LANDING_TEMPLATES = ["PROBLEM_SOLUTION", "VIRAL", "PREMIUM", "IMPULSE", "UGC"] as const;
export type LandingTemplate = (typeof LANDING_TEMPLATES)[number];

export const SECTION_TYPES = [
  "HERO",
  "PROBLEM",
  "SOLUTION",
  "BENEFITS",
  "FEATURES",
  "HOW_IT_WORKS",
  "DEMO",
  "COMPARISON",
  "SOCIAL_PROOF",
  "FAQ",
  "CTA",
  "TRUST",
  "SHIPPING",
  "RETURNS",
  "DISCLOSURE",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const EVENT_TYPES = [
  "PAGE_VIEW",
  "PRODUCT_VIEW",
  "PRODUCT_CLICK",
  "AFFILIATE_CLICK",
  "CHECKOUT",
  "SOCIAL_CLICK",
  "NEWSLETTER_SIGNUP",
  // A tracked-link click that could not be sent to the merchant (link paused/broken, listing unpublished).
  "REDIRECT_FALLBACK",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const CONVERSION_TYPES = ["PURCHASE", "LEAD", "CHECKOUT_STARTED"] as const;
export type ConversionType = (typeof CONVERSION_TYPES)[number];

export const COMMISSION_STATUSES = ["PENDING", "APPROVED", "PAID", "REVERSED"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const EXPERIMENT_TYPES = ["HEADLINE", "HERO_IMAGE", "CTA", "PRICE", "ANGLE", "STRUCTURE", "OFFER", "VIDEO_HOOK"] as const;
export type ExperimentType = (typeof EXPERIMENT_TYPES)[number];

export const EXPERIMENT_STATUSES = ["DRAFT", "RUNNING", "COMPLETED", "STOPPED"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "NEW_OPPORTUNITY",
  "PRODUCT_WINNER",
  "PRODUCT_KILL",
  "LINK_BROKEN",
  "TRAFFIC_SPIKE",
  "CONVERSION_SPIKE",
  "INVENTORY_UNAVAILABLE",
  "REPORT_READY",
  "SYSTEM",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["DASHBOARD", "EMAIL", "TELEGRAM"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const SEVERITIES = ["info", "success", "warning", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const RECOMMENDATION_STATUSES = ["OPEN", "DONE", "DISMISSED"] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STORE_TYPES = ["STOREFRONT", "SHOPIFY", "AFFILIATE_PROJECT", "LANDING"] as const;
export type StoreType = (typeof STORE_TYPES)[number];

export const SOURCE_ADAPTERS = [
  "MANUAL_IMPORT",
  "SHOPIFY_SUPPLIER",
  "ALIEXPRESS",
  "CJ",
  "DSERS",
  "AFFILIATE_NETWORK",
  "AMAZON",
  "TIKTOK_SHOP",
  "SOCIAL_TREND",
  "WIKIPEDIA_TRENDS",
  "DEMO",
] as const;
export type SourceAdapterKey = (typeof SOURCE_ADAPTERS)[number];

export const AFFILIATE_NETWORK_TYPES = [
  "IMPACT",
  "AWIN",
  "SHAREASALE",
  "PARTNERSTACK",
  "RAKUTEN",
  "AMAZON_ASSOCIATES",
  "CJ_AFFILIATE",
  "CUSTOM",
] as const;
export type AffiliateNetworkType = (typeof AFFILIATE_NETWORK_TYPES)[number];

/**
 * Review lifecycle of a network product listing (affiliate_products) — separate from the research /
 * testing lifecycle of FORGE products: DISCOVERED → REVIEW → APPROVED → PUBLISHED → ARCHIVED, with
 * REJECTED from review and restore back to REVIEW. Transitions live in src/domain/affiliate-products.ts.
 */
export const AFFILIATE_PRODUCT_STATUSES = ["DISCOVERED", "REVIEW", "APPROVED", "PUBLISHED", "REJECTED", "ARCHIVED"] as const;
export type AffiliateProductStatus = (typeof AFFILIATE_PRODUCT_STATUSES)[number];

export const AFFILIATE_AVAILABILITY = ["IN_STOCK", "OUT_OF_STOCK", "PREORDER", "BACKORDER", "UNKNOWN"] as const;
export type AffiliateAvailability = (typeof AFFILIATE_AVAILABILITY)[number];

export const INTEGRATION_KINDS = [
  "SHOPIFY",
  "TIKTOK",
  "INSTAGRAM",
  "YOUTUBE",
  "PINTEREST",
  "FACEBOOK",
  "X",
  "EMAIL",
  "TELEGRAM",
] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const ASSET_KINDS = ["IMAGE", "VIDEO", "UGC", "THUMBNAIL", "LOGO", "CREATIVE_VARIANT"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ARTICLE_TYPES = ["LISTICLE", "BEST_FOR", "VERSUS", "ALTERNATIVES", "GUIDE"] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

export const ARTICLE_STATUSES = ["IDEA", "DRAFT", "PUBLISHED"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const RTL_LOCALES: Locale[] = ["ar"];

export const CURRENCIES = ["USD", "EUR", "EGP", "GBP", "SAR", "AED"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const MARKETS = [
  { code: "US", name: "United States", currency: "USD", countries: ["US"] },
  { code: "GB", name: "United Kingdom", currency: "GBP", countries: ["GB"] },
  { code: "CA", name: "Canada", currency: "USD", countries: ["CA"] },
  { code: "AU", name: "Australia", currency: "USD", countries: ["AU"] },
  { code: "EU", name: "Europe", currency: "EUR", countries: ["DE", "FR", "IT", "ES", "NL", "BE", "IE", "AT", "SE", "DK", "FI", "PT", "PL"] },
  { code: "GCC", name: "GCC", currency: "AED", countries: ["AE", "SA", "QA", "KW", "BH", "OM"] },
] as const;
export type MarketCode = (typeof MARKETS)[number]["code"];

export const JOB_TYPES = [
  "product_discovery",
  "product_research",
  "product_scoring",
  "trend_refresh",
  "affiliate_link_check",
  "content_generation",
  "landing_page_generation",
  "analytics_sync",
  "shopify_sync",
  "report_generation",
  "notification_dispatch",
  "recommendations_refresh",
  "test_evaluation",
  "launch_test_kit",
  "first_run",
  "affiliate_refresh",
] as const;
export type JobType = (typeof JOB_TYPES)[number];
