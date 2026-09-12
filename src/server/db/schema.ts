import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  AFFILIATE_NETWORK_TYPES,
  AFFILIATE_PRODUCT_STATUSES,
  ARTICLE_STATUSES,
  ARTICLE_TYPES,
  ASSET_KINDS,
  BUSINESS_MODELS,
  CAMPAIGN_STATUSES,
  COMMISSION_STATUSES,
  CONTENT_ANGLES,
  CONTENT_STATUSES,
  CONTENT_TYPES,
  CONVERSION_TYPES,
  DECISIONS,
  EVENT_TYPES,
  EXPERIMENT_STATUSES,
  EXPERIMENT_TYPES,
  GENERATION_METHODS,
  INTEGRATION_KINDS,
  INTEGRATION_STATUSES,
  JOB_STATUSES,
  LANDING_TEMPLATES,
  LINK_STATUSES,
  NOTIFICATION_TYPES,
  PAGE_STATUSES,
  PLATFORMS,
  PRIORITIES,
  PRODUCT_STATUSES,
  PROVENANCES,
  RECOMMENDATION_STATUSES,
  RISK_LEVELS,
  RUN_STATUSES,
  SECTION_TYPES,
  SEVERITIES,
  SOURCE_ADAPTERS,
  STORE_TYPES,
  TEST_VERDICTS,
  USER_ROLES,
  type Provenance,
} from "../../lib/constants";

// ── Enums ────────────────────────────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", USER_ROLES);
export const productStatusEnum = pgEnum("product_status", PRODUCT_STATUSES);
export const businessModelEnum = pgEnum("business_model", BUSINESS_MODELS);
export const provenanceEnum = pgEnum("data_provenance", PROVENANCES);
export const contentStatusEnum = pgEnum("content_status", CONTENT_STATUSES);
export const platformEnum = pgEnum("platform", PLATFORMS);
export const contentTypeEnum = pgEnum("content_type", CONTENT_TYPES);
export const contentAngleEnum = pgEnum("content_angle", CONTENT_ANGLES);
export const generationMethodEnum = pgEnum("generation_method", GENERATION_METHODS);
export const integrationStatusEnum = pgEnum("integration_status", INTEGRATION_STATUSES);
export const linkStatusEnum = pgEnum("link_status", LINK_STATUSES);
export const jobStatusEnum = pgEnum("job_status", JOB_STATUSES);
export const runStatusEnum = pgEnum("run_status", RUN_STATUSES);
export const decisionEnum = pgEnum("product_decision", DECISIONS);
export const testVerdictEnum = pgEnum("test_verdict", TEST_VERDICTS);
export const pageStatusEnum = pgEnum("page_status", PAGE_STATUSES);
export const landingTemplateEnum = pgEnum("landing_template", LANDING_TEMPLATES);
export const sectionTypeEnum = pgEnum("section_type", SECTION_TYPES);
export const eventTypeEnum = pgEnum("event_type", EVENT_TYPES);
export const conversionTypeEnum = pgEnum("conversion_type", CONVERSION_TYPES);
export const commissionStatusEnum = pgEnum("commission_status", COMMISSION_STATUSES);
export const campaignStatusEnum = pgEnum("campaign_status", CAMPAIGN_STATUSES);
export const experimentTypeEnum = pgEnum("experiment_type", EXPERIMENT_TYPES);
export const experimentStatusEnum = pgEnum("experiment_status", EXPERIMENT_STATUSES);
export const notificationTypeEnum = pgEnum("notification_type", NOTIFICATION_TYPES);
export const severityEnum = pgEnum("severity", SEVERITIES);
export const recommendationStatusEnum = pgEnum("recommendation_status", RECOMMENDATION_STATUSES);
export const priorityEnum = pgEnum("priority", PRIORITIES);
export const storeTypeEnum = pgEnum("store_type", STORE_TYPES);
export const sourceAdapterEnum = pgEnum("source_adapter", SOURCE_ADAPTERS);
export const affiliateNetworkTypeEnum = pgEnum("affiliate_network_type", AFFILIATE_NETWORK_TYPES);
export const integrationKindEnum = pgEnum("integration_kind", INTEGRATION_KINDS);
export const assetKindEnum = pgEnum("asset_kind", ASSET_KINDS);
export const articleTypeEnum = pgEnum("article_type", ARTICLE_TYPES);
export const articleStatusEnum = pgEnum("article_status", ARTICLE_STATUSES);
export const riskLevelEnum = pgEnum("risk_level", RISK_LEVELS);

// ── Column helpers ───────────────────────────────────────────────────────────
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const orgRef = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

export type FieldProvenance = { p: Provenance; source?: string; at?: string; note?: string };
export type SourceEvidence = { label: string; url?: string; provenance: Provenance; observedAt?: string };

// ── Tenancy & identity ───────────────────────────────────────────────────────
export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  defaultMarket: text("default_market").notNull().default("US"),
  defaultLocale: text("default_locale").notNull().default("en"),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    organizationId: orgRef(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("viewer"),
    locale: text("locale").notNull().default("en"),
    disabled: boolean("disabled").notNull().default(false),
    lastLoginAt: ts("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the opaque session token. The raw token only ever lives in the cookie.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    organizationId: orgRef(),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    role: userRoleEnum("role").notNull().default("viewer"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash)],
);

export const stores = pgTable(
  "stores",
  {
    id: id(),
    organizationId: orgRef(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: storeTypeEnum("type").notNull().default("STOREFRONT"),
    domain: text("domain"),
    currency: text("currency").notNull().default("USD"),
    locale: text("locale").notNull().default("en"),
    market: text("market").notNull().default("US"),
    shopifyDomain: text("shopify_domain"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("stores_org_slug_uq").on(t.organizationId, t.slug)],
);

// ── Catalog ──────────────────────────────────────────────────────────────────
export const categories = pgTable(
  "categories",
  {
    id: id(),
    organizationId: orgRef(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    parentId: uuid("parent_id"),
    description: text("description"),
    icon: text("icon"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("categories_org_slug_uq").on(t.organizationId, t.slug)],
);

export const suppliers = pgTable("suppliers", {
  id: id(),
  organizationId: orgRef(),
  name: text("name").notNull(),
  adapter: sourceAdapterEnum("adapter").notNull().default("MANUAL_IMPORT"),
  website: text("website"),
  shippingDaysMin: integer("shipping_days_min"),
  shippingDaysMax: integer("shipping_days_max"),
  rating: doublePrecision("rating"),
  countries: text("countries").array().notNull().default(sql`'{}'::text[]`),
  notes: text("notes"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

/** A configured discovery source (an adapter instance with its non-secret config and encrypted credentials). */
export const productSources = pgTable("product_sources", {
  id: id(),
  organizationId: orgRef(),
  adapter: sourceAdapterEnum("adapter").notNull(),
  name: text("name").notNull(),
  status: integrationStatusEnum("status").notNull().default("NOT_CONFIGURED"),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  credentialsEncrypted: text("credentials_encrypted"),
  lastRunAt: ts("last_run_at"),
  lastError: text("last_error"),
  lastResultCount: integer("last_result_count"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const products = pgTable(
  "products",
  {
    id: id(),
    organizationId: orgRef(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    subcategoryId: uuid("subcategory_id").references(() => categories.id, { onDelete: "set null" }),
    brand: text("brand"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    supplierUrl: text("supplier_url"),
    productUrl: text("product_url"),
    affiliateUrl: text("affiliate_url"),
    imageUrl: text("image_url"),
    gallery: jsonb("gallery").$type<string[]>().notNull().default([]),
    shopifyProductId: text("shopify_product_id"),
    source: sourceAdapterEnum("source").notNull().default("MANUAL_IMPORT"),
    sourceId: uuid("source_id").references(() => productSources.id, { onDelete: "set null" }),
    sourceProductId: text("source_product_id"),
    currency: text("currency").notNull().default("USD"),
    cost: money("cost"),
    sellingPrice: money("selling_price"),
    affiliateCommission: money("affiliate_commission"),
    commissionPercentage: doublePrecision("commission_percentage"),
    estimatedMargin: doublePrecision("estimated_margin"),
    shippingCost: money("shipping_cost"),
    shippingDaysMin: integer("shipping_days_min"),
    shippingDaysMax: integer("shipping_days_max"),
    countriesAvailable: text("countries_available").array().notNull().default(sql`'{}'::text[]`),
    rating: doublePrecision("rating"),
    reviewCount: integer("review_count"),
    reviewGrowth: doublePrecision("review_growth"),
    estimatedSales: integer("estimated_sales"),
    salesVelocity: doublePrecision("sales_velocity"),
    sellerCount: integer("seller_count"),
    adActivity: doublePrecision("ad_activity"),
    trendKeyword: text("trend_keyword"),
    // Raw 0–100 factor inputs (from sources, AI or operators) — provenance tracked in field_provenance.
    trendScore: doublePrecision("trend_score"),
    competitionScore: doublePrecision("competition_score"),
    contentScore: doublePrecision("content_score"),
    impulseScore: doublePrecision("impulse_score"),
    marginScore: doublePrecision("margin_score"),
    problemScore: doublePrecision("problem_score"),
    noveltyScore: doublePrecision("novelty_score"),
    saturationScore: doublePrecision("saturation_score"),
    shippingScore: doublePrecision("shipping_score"),
    overallScore: doublePrecision("overall_score"),
    scoreConfidence: doublePrecision("score_confidence"),
    riskLevel: riskLevelEnum("risk_level"),
    riskFlags: jsonb("risk_flags").$type<string[]>().notNull().default([]),
    status: productStatusEnum("status").notNull().default("DISCOVERED"),
    businessModel: businessModelEnum("business_model").notNull().default("AFFILIATE"),
    businessModels: jsonb("business_models").$type<string[]>().notNull().default(["AFFILIATE"]),
    targetAudience: text("target_audience"),
    problemSolved: text("problem_solved"),
    // Verifiable product facts (from supplier/merchant data or the operator) used by copy generation.
    highlights: jsonb("highlights").$type<string[]>().notNull().default([]),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    available: boolean("available").notNull().default(true),
    fieldProvenance: jsonb("field_provenance").$type<Record<string, FieldProvenance>>().notNull().default({}),
    // Set when the product shows data from an affiliate network listing (affiliate_products.product_id):
    // the storefront stops showing the product once the network data expires (Amazon: 24 h after
    // fetching) — a refresh moves it forward. NULL = no freshness rule.
    externalDataExpiresAt: ts("external_data_expires_at"),
    // When the network requires prices to be shown with the time they were observed: that time.
    priceAsOf: ts("price_as_of"),
    isDemo: boolean("is_demo").notNull().default(false),
    discoveredAt: ts("discovered_at").notNull().defaultNow(),
    lastCheckedAt: ts("last_checked_at"),
    statusChangedAt: ts("status_changed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_org_slug_uq").on(t.organizationId, t.slug),
    index("products_org_status_idx").on(t.organizationId, t.status),
    index("products_org_score_idx").on(t.organizationId, t.overallScore),
    index("products_category_idx").on(t.categoryId),
    uniqueIndex("products_source_uq")
      .on(t.organizationId, t.source, t.sourceProductId)
      .where(sql`source_product_id is not null`),
  ],
);

export const productStores = pgTable(
  "product_stores",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    published: boolean("published").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.storeId] })],
);

/** Time series of market signals (trend interest, review counts, price, ad counts…), each with provenance. */
export const productSignals = pgTable(
  "product_signals",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    signal: text("signal").notNull(),
    value: doublePrecision("value").notNull(),
    provenance: provenanceEnum("provenance").notNull(),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    observedAt: ts("observed_at").notNull().defaultNow(),
  },
  (t) => [index("product_signals_product_signal_idx").on(t.productId, t.signal, t.observedAt)],
);

export const productScores = pgTable(
  "product_scores",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    overall: doublePrecision("overall").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    factors: jsonb("factors").$type<Record<string, { score: number; weight: number; provenance: string; note: string }>>().notNull(),
    weights: jsonb("weights").$type<Record<string, number>>().notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    riskLevel: riskLevelEnum("risk_level").notNull().default("LOW"),
    engineVersion: text("engine_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("product_scores_product_idx").on(t.productId, t.createdAt)],
);

/** Daily performance rollup per product (computed from events by the analytics_sync job). */
export const productMetrics = pgTable(
  "product_metrics",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    pageViews: integer("page_views").notNull().default(0),
    productClicks: integer("product_clicks").notNull().default(0),
    affiliateClicks: integer("affiliate_clicks").notNull().default(0),
    orders: integer("orders").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    revenue: money("revenue").notNull().default(0),
    commission: money("commission").notNull().default(0),
    cost: money("cost").notNull().default(0),
    provenance: provenanceEnum("provenance").notNull().default("REAL"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("product_metrics_product_date_uq").on(t.productId, t.date)],
);

export const productResearch = pgTable(
  "product_research",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    agentRunId: uuid("agent_run_id"),
    verdict: text("verdict").notNull(), // TEST | WATCH | DO_NOT_TEST
    thesis: text("thesis").notNull(),
    antiThesis: text("anti_thesis").notNull(),
    whyTrending: text("why_trending"),
    demand: text("demand"),
    competition: text("competition"),
    pricing: jsonb("pricing").$type<{ supplierCost?: number | null; suggestedPrice?: number | null; margin?: number | null; commission?: number | null; currency: string }>(),
    supplierNotes: text("supplier_notes"),
    shippingNotes: text("shipping_notes"),
    socialPotential: text("social_potential"),
    contentOpportunity: text("content_opportunity"),
    targetCustomer: text("target_customer"),
    marketingAngles: jsonb("marketing_angles").$type<string[]>().notNull().default([]),
    hooks: jsonb("hooks").$type<string[]>().notNull().default([]),
    ctas: jsonb("ctas").$type<string[]>().notNull().default([]),
    landingAngle: text("landing_angle"),
    risks: jsonb("risks").$type<string[]>().notNull().default([]),
    riskLevel: riskLevelEnum("risk_level").notNull().default("MEDIUM"),
    recommendedAction: text("recommended_action"),
    sourceEvidence: jsonb("source_evidence").$type<SourceEvidence[]>().notNull().default([]),
    generationMethod: generationMethodEnum("generation_method").notNull(),
    provenance: provenanceEnum("provenance").notNull(),
    model: text("model"),
    createdAt: createdAt(),
  },
  (t) => [index("product_research_product_idx").on(t.productId, t.createdAt)],
);

export const productReviews = pgTable(
  "product_reviews",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    // Only REAL, attributable reviews may be stored. FORGE never generates reviews.
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    authorDisplay: text("author_display"),
    rating: doublePrecision("rating"),
    body: text("body").notNull(),
    reviewedAt: ts("reviewed_at"),
    importedAt: createdAt(),
  },
  (t) => [index("product_reviews_product_idx").on(t.productId)],
);

export const productTests = pgTable(
  "product_tests",
  {
    id: id(),
    organizationId: orgRef(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("RUNNING"), // RUNNING | COMPLETED | CANCELLED
    startedAt: ts("started_at").notNull().defaultNow(),
    plannedDays: integer("planned_days").notNull().default(14),
    endedAt: ts("ended_at"),
    verdict: testVerdictEnum("verdict"),
    decision: decisionEnum("decision"),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    thresholds: jsonb("thresholds").$type<Record<string, unknown>>().notNull().default({}),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    lastEvaluatedAt: ts("last_evaluated_at"),
    createdAt: createdAt(),
  },
  (t) => [index("product_tests_product_idx").on(t.productId, t.startedAt)],
);

export const productDecisions = pgTable(
  "product_decisions",
  {
    id: id(),
    organizationId: orgRef(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    decision: decisionEnum("decision").notNull(),
    verdict: testVerdictEnum("verdict"),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    applied: boolean("applied").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("product_decisions_product_idx").on(t.productId, t.createdAt)],
);

// ── Affiliate ────────────────────────────────────────────────────────────────
export const affiliateNetworks = pgTable(
  "affiliate_networks",
  {
    id: id(),
    organizationId: orgRef(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: affiliateNetworkTypeEnum("type").notNull(),
    status: integrationStatusEnum("status").notNull().default("NOT_CONFIGURED"),
    website: text("website"),
    defaultCookieDays: integer("default_cookie_days"),
    // Query-string parameter the network uses to carry our click id back in postbacks (e.g. subId1, clickref).
    subIdParam: text("sub_id_param"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    credentialsEncrypted: text("credentials_encrypted"),
    postbackSecretEncrypted: text("postback_secret_encrypted"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("affiliate_networks_org_slug_uq").on(t.organizationId, t.slug)],
);

export const affiliateLinks = pgTable(
  "affiliate_links",
  {
    id: id(),
    organizationId: orgRef(),
    networkId: uuid("network_id").references(() => affiliateNetworks.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    // The network listing this link was published from — its URL is managed by the listing (refresh keeps it current).
    affiliateProductId: uuid("affiliate_product_id").references(() => affiliateProducts.id, { onDelete: "set null" }),
    merchant: text("merchant"),
    url: text("url").notNull(),
    code: text("code").notNull(),
    commissionRate: doublePrecision("commission_rate"),
    commissionFlat: money("commission_flat"),
    cookieDays: integer("cookie_days"),
    country: text("country"),
    isPrimary: boolean("is_primary").notNull().default(true),
    status: linkStatusEnum("status").notNull().default("UNCHECKED"),
    lastCheckedAt: ts("last_checked_at"),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("affiliate_links_code_uq").on(t.code), index("affiliate_links_product_idx").on(t.productId), index("affiliate_links_listing_idx").on(t.affiliateProductId)],
);

export const affiliateProductStatusEnum = pgEnum("affiliate_product_status", AFFILIATE_PRODUCT_STATUSES);

/**
 * A product listing from an affiliate network or merchant marketplace (e.g. an ASIN on www.amazon.eg),
 * normalised so FORGE treats every network the same way. Network-specific fetching lives in
 * src/server/affiliate/<provider>; review, n8n and publishing only use this row. Separate from
 * `products` (the research/testing lifecycle) — `productId` links the storefront product once published.
 * `dataFetchedAt` enforces freshness: Amazon's licence allows showing fetched data for at most 24 hours.
 */
export const affiliateProducts = pgTable(
  "affiliate_products",
  {
    id: id(),
    organizationId: orgRef(),
    network: affiliateNetworkTypeEnum("network").notNull(),
    networkId: uuid("network_id").references(() => affiliateNetworks.id, { onDelete: "set null" }),
    merchant: text("merchant"),
    marketplace: text("marketplace").notNull(), // e.g. www.amazon.eg
    country: text("country").notNull(), // ISO 3166-1 alpha-2
    externalId: text("external_id").notNull(), // ASIN or the network's product id
    externalIdType: text("external_id_type").notNull().default("ID"), // ASIN, PRODUCT_ID… (the provider's id kind)
    parentExternalId: text("parent_external_id"),
    title: text("title").notNull(),
    description: text("description"),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    category: text("category"),
    categoryPath: jsonb("category_path").$type<string[]>().notNull().default([]),
    brand: text("brand"),
    productUrl: text("product_url"),
    affiliateUrl: text("affiliate_url"),
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default([]), // links only — never copied
    price: money("price"),
    currency: text("currency"),
    priceDisplay: text("price_display"),
    availability: text("availability").notNull().default("UNKNOWN"), // AFFILIATE_AVAILABILITY
    availabilityMessage: text("availability_message"),
    rating: doublePrecision("rating"),
    reviewCount: integer("review_count"),
    reviewSource: text("review_source"), // set only when the network legitimately supplies review data
    commissionRate: doublePrecision("commission_rate"), // as supplied by the network
    networkMeta: jsonb("network_meta").$type<Record<string, unknown>>().notNull().default({}),
    // ── FORGE-owned (editorial) fields — edited in FORGE, never overwritten by a refresh ──
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }), // storefront category
    summary: text("summary"), // FORGE's own description, shown instead of / when the network has none
    problemSolved: text("problem_solved"),
    targetAudience: text("target_audience"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    expectedCommissionRate: doublePrecision("expected_commission_rate"), // operator's figure from the network's rate card
    // Score recorded by an automation (e.g. n8n) or an operator — always with its provenance and source.
    score: doublePrecision("score"),
    scoreProvenance: provenanceEnum("score_provenance"),
    scoreSource: text("score_source"),
    scoreReasons: jsonb("score_reasons").$type<string[]>().notNull().default([]),
    scoredAt: ts("scored_at"),
    // ── Review lifecycle ──
    status: affiliateProductStatusEnum("status").notNull().default("DISCOVERED"),
    statusChangedAt: ts("status_changed_at"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewNote: text("review_note"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    publishedAt: ts("published_at"),
    // Incremented by every edit and transition — clients send the revision they saw (concurrent-edit protection).
    revision: integer("revision").notNull().default(1),
    ingestSource: text("ingest_source").notNull().default("api"), // provider | n8n | api | manual
    provenance: provenanceEnum("provenance").notNull().default("REAL"),
    dataFetchedAt: ts("data_fetched_at"),
    lastSyncError: text("last_sync_error"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("affiliate_products_listing_uq").on(t.organizationId, t.network, t.marketplace, t.externalId),
    index("affiliate_products_org_status_idx").on(t.organizationId, t.status),
    index("affiliate_products_org_fetched_idx").on(t.organizationId, t.dataFetchedAt),
    index("affiliate_products_product_idx").on(t.productId),
  ],
);
export type AffiliateProduct = typeof affiliateProducts.$inferSelect;

// ── Marketing ────────────────────────────────────────────────────────────────
export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    organizationId: orgRef(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    platform: platformEnum("platform").notNull().default("TIKTOK"),
    objective: text("objective"),
    status: campaignStatusEnum("status").notNull().default("DRAFT"),
    utmSource: text("utm_source").notNull(),
    utmMedium: text("utm_medium").notNull().default("organic"),
    utmCampaign: text("utm_campaign").notNull(),
    budget: money("budget"),
    spend: money("spend").notNull().default(0),
    startAt: ts("start_at"),
    endAt: ts("end_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("campaigns_org_slug_uq").on(t.organizationId, t.slug)],
);

export type ScriptBeat = { label: "HOOK" | "PROBLEM" | "DEMONSTRATION" | "PAYOFF" | "CTA"; from: number; to: number; line: string; visual: string };

/** Content items — also the content calendar (scheduledAt + status). */
export const content = pgTable(
  "content",
  {
    id: id(),
    organizationId: orgRef(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    platform: platformEnum("platform").notNull(),
    contentType: contentTypeEnum("content_type").notNull(),
    angle: contentAngleEnum("angle"),
    title: text("title").notNull(),
    hook: text("hook"),
    script: jsonb("script").$type<ScriptBeat[]>(),
    body: text("body"),
    caption: text("caption"),
    cta: text("cta"),
    hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
    status: contentStatusEnum("status").notNull().default("IDEA"),
    scheduledAt: ts("scheduled_at"),
    publishedAt: ts("published_at"),
    externalPostId: text("external_post_id"),
    externalUrl: text("external_url"),
    utmContent: text("utm_content"),
    trackingLinkId: uuid("tracking_link_id").references(() => affiliateLinks.id, { onDelete: "set null" }),
    sponsoredDisclosure: text("sponsored_disclosure"),
    generationMethod: generationMethodEnum("generation_method").notNull().default("MANUAL"),
    model: text("model"),
    agentRunId: uuid("agent_run_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("content_org_status_idx").on(t.organizationId, t.status),
    index("content_product_idx").on(t.productId),
    index("content_scheduled_idx").on(t.organizationId, t.scheduledAt),
    uniqueIndex("content_product_utm_content_uq").on(t.productId, t.utmContent).where(sql`utm_content is not null`),
  ],
);

export const contentAssets = pgTable(
  "content_assets",
  {
    id: id(),
    organizationId: orgRef(),
    contentId: uuid("content_id").references(() => content.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    kind: assetKindEnum("kind").notNull(),
    url: text("url"),
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: doublePrecision("duration_seconds"),
    provider: text("provider").notNull().default("URL"),
    prompt: text("prompt"),
    status: text("status").notNull().default("READY"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("content_assets_content_idx").on(t.contentId), index("content_assets_product_idx").on(t.productId)],
);

export const contentMetrics = pgTable(
  "content_metrics",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    views: integer("views").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    profileVisits: integer("profile_visits").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    productPageVisits: integer("product_page_visits").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    revenue: money("revenue").notNull().default(0),
    commission: money("commission").notNull().default(0),
    cost: money("cost").notNull().default(0),
    provenance: provenanceEnum("provenance").notNull().default("MANUAL"),
    source: text("source").notNull().default("manual"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("content_metrics_content_date_uq").on(t.contentId, t.date)],
);

export type SectionContent = Record<string, unknown>;

export const landingPages = pgTable(
  "landing_pages",
  {
    id: id(),
    organizationId: orgRef(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    template: landingTemplateEnum("template").notNull().default("PROBLEM_SOLUTION"),
    status: pageStatusEnum("status").notNull().default("DRAFT"),
    locale: text("locale").notNull().default("en"),
    headline: text("headline").notNull(),
    subheadline: text("subheadline"),
    seoTitle: text("seo_title").notNull(),
    metaDescription: text("meta_description").notNull(),
    canonicalPath: text("canonical_path"),
    ogImage: text("og_image"),
    ctaLabel: text("cta_label").notNull().default("Check price"),
    generationMethod: generationMethodEnum("generation_method").notNull().default("MANUAL"),
    model: text("model"),
    agentRunId: uuid("agent_run_id"),
    publishedAt: ts("published_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("landing_pages_org_slug_uq").on(t.organizationId, t.slug), index("landing_pages_product_idx").on(t.productId)],
);

export const landingPageSections = pgTable(
  "landing_page_sections",
  {
    id: id(),
    landingPageId: uuid("landing_page_id")
      .notNull()
      .references(() => landingPages.id, { onDelete: "cascade" }),
    type: sectionTypeEnum("type").notNull(),
    position: integer("position").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // When set, this section only renders for visitors bucketed into that experiment variant.
    variantKey: text("variant_key"),
    content: jsonb("content").$type<SectionContent>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("landing_page_sections_page_idx").on(t.landingPageId, t.position)],
);

export const articles = pgTable(
  "articles",
  {
    id: id(),
    organizationId: orgRef(),
    slug: text("slug").notNull(),
    type: articleTypeEnum("type").notNull().default("GUIDE"),
    status: articleStatusEnum("status").notNull().default("IDEA"),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    body: jsonb("body").$type<{ blocks: Array<{ kind: "p" | "h2" | "product" | "list"; text?: string; productId?: string; items?: string[] }> }>()
      .notNull()
      .default({ blocks: [] }),
    productIds: jsonb("product_ids").$type<string[]>().notNull().default([]),
    seoTitle: text("seo_title"),
    metaDescription: text("meta_description"),
    generationMethod: generationMethodEnum("generation_method").notNull().default("MANUAL"),
    publishedAt: ts("published_at"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("articles_org_slug_uq").on(t.organizationId, t.slug)],
);

// ── Tracking, conversions & money ────────────────────────────────────────────
export const clickEvents = pgTable(
  "click_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgRef(),
    eventType: eventTypeEnum("event_type").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    affiliateLinkId: uuid("affiliate_link_id").references(() => affiliateLinks.id, { onDelete: "set null" }),
    // The network listing behind a tracked-link click (kept even if the storefront product is later unlinked).
    affiliateProductId: uuid("affiliate_product_id").references(() => affiliateProducts.id, { onDelete: "set null" }),
    // Merchant host a click was redirected to (AFFILIATE_CLICK = an outbound redirect that was served).
    destinationHost: text("destination_host"),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    contentId: uuid("content_id").references(() => content.id, { onDelete: "set null" }),
    landingPageId: uuid("landing_page_id").references(() => landingPages.id, { onDelete: "set null" }),
    experimentId: uuid("experiment_id"),
    variant: text("variant"),
    visitorId: text("visitor_id"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    referrer: text("referrer"),
    path: text("path"),
    country: text("country"),
    device: text("device"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    isBot: boolean("is_bot").notNull().default(false),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("click_events_org_created_idx").on(t.organizationId, t.createdAt),
    index("click_events_product_created_idx").on(t.productId, t.createdAt),
    index("click_events_type_idx").on(t.organizationId, t.eventType, t.createdAt),
    index("click_events_utm_content_idx").on(t.organizationId, t.utmContent),
    index("click_events_listing_created_idx").on(t.affiliateProductId, t.createdAt),
  ],
);

export const conversionEvents = pgTable(
  "conversion_events",
  {
    id: id(),
    organizationId: orgRef(),
    type: conversionTypeEnum("type").notNull().default("PURCHASE"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    affiliateLinkId: uuid("affiliate_link_id").references(() => affiliateLinks.id, { onDelete: "set null" }),
    clickEventId: uuid("click_event_id"),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    contentId: uuid("content_id").references(() => content.id, { onDelete: "set null" }),
    orderId: uuid("order_id"),
    source: text("source").notNull(),
    externalId: text("external_id"),
    revenue: money("revenue").notNull().default(0),
    commission: money("commission").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    utmSource: text("utm_source"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    country: text("country"),
    provenance: provenanceEnum("provenance").notNull().default("REAL"),
    isDemo: boolean("is_demo").notNull().default(false),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversion_events_source_ext_uq").on(t.organizationId, t.source, t.externalId).where(sql`external_id is not null`),
    index("conversion_events_org_time_idx").on(t.organizationId, t.occurredAt),
    index("conversion_events_product_idx").on(t.productId, t.occurredAt),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    organizationId: orgRef(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    source: text("source").notNull(), // SHOPIFY | DROPSHIP | MANUAL | DEMO
    externalOrderId: text("external_order_id"),
    /** Shopify line-item GID — one row per line item so revenue is credited per product. '' for single-line sources. */
    externalLineId: text("external_line_id").notNull().default(""),
    /** PAID | PARTIALLY_REFUNDED | REFUNDED | CANCELLED | PENDING | VOIDED (see EXCLUDED_ORDER_STATUSES). */
    status: text("status").notNull().default("PAID"),
    /** Net quantity after refunds/removals. */
    quantity: integer("quantity").notNull().default(1),
    /** Net revenue after discounts and refunds, before tax and shipping charged. */
    revenue: money("revenue").notNull().default(0),
    refundedAmount: money("refunded_amount").notNull().default(0),
    cost: money("cost").notNull().default(0),
    shippingCost: money("shipping_cost").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    country: text("country"),
    utmSource: text("utm_source"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    isDemo: boolean("is_demo").notNull().default(false),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    /** The source system's last-modified time; older deliveries never overwrite newer state. */
    sourceUpdatedAt: ts("source_updated_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_source_ext_line_uq").on(t.organizationId, t.source, t.externalOrderId, t.externalLineId).where(sql`external_order_id is not null`),
    index("orders_org_time_idx").on(t.organizationId, t.occurredAt),
  ],
);

export const commissions = pgTable(
  "commissions",
  {
    id: id(),
    organizationId: orgRef(),
    networkId: uuid("network_id").references(() => affiliateNetworks.id, { onDelete: "set null" }),
    affiliateLinkId: uuid("affiliate_link_id").references(() => affiliateLinks.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    conversionEventId: uuid("conversion_event_id").references(() => conversionEvents.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: commissionStatusEnum("status").notNull().default("PENDING"),
    isDemo: boolean("is_demo").notNull().default(false),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("commissions_org_time_idx").on(t.organizationId, t.occurredAt)],
);

export type ExperimentVariant = { key: string; name: string; weight: number; changes: Record<string, unknown> };

export const experiments = pgTable(
  "experiments",
  {
    id: id(),
    organizationId: orgRef(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    landingPageId: uuid("landing_page_id").references(() => landingPages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: experimentTypeEnum("type").notNull(),
    status: experimentStatusEnum("status").notNull().default("DRAFT"),
    hypothesis: text("hypothesis"),
    primaryMetric: text("primary_metric").notNull().default("AFFILIATE_CTR"),
    variants: jsonb("variants").$type<ExperimentVariant[]>().notNull(),
    winnerVariant: text("winner_variant"),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    createdAt: createdAt(),
  },
  (t) => [index("experiments_lp_idx").on(t.landingPageId, t.status)],
);

export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: id(),
    organizationId: orgRef(),
    email: text("email").notNull(),
    locale: text("locale").notNull().default("en"),
    source: text("source"),
    consentAt: ts("consent_at").notNull().defaultNow(),
    unsubscribedAt: ts("unsubscribed_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("newsletter_org_email_uq").on(t.organizationId, t.email)],
);

// ── Intelligence outputs ─────────────────────────────────────────────────────
export const recommendations = pgTable(
  "recommendations",
  {
    id: id(),
    organizationId: orgRef(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    fingerprint: text("fingerprint").notNull(),
    priority: priorityEnum("priority").notNull().default("MEDIUM"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    action: jsonb("action").$type<{ kind: string; label: string; params?: Record<string, unknown> } | null>(),
    evidence: jsonb("evidence").$type<Record<string, number | string>>().notNull().default({}),
    status: recommendationStatusEnum("status").notNull().default("OPEN"),
    source: text("source").notNull().default("RULES"),
    createdAt: createdAt(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [
    index("recommendations_org_status_idx").on(t.organizationId, t.status),
    uniqueIndex("recommendations_open_fp_uq").on(t.organizationId, t.fingerprint).where(sql`status = 'OPEN'`),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: id(),
    organizationId: orgRef(),
    type: text("type").notNull(), // TOP5_DAILY | TOP5_WEEKLY
    periodStart: ts("period_start").notNull(),
    periodEnd: ts("period_end").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("reports_org_type_idx").on(t.organizationId, t.type, t.createdAt)],
);

// ── Integrations ─────────────────────────────────────────────────────────────
export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    organizationId: orgRef(),
    kind: integrationKindEnum("kind").notNull(),
    status: integrationStatusEnum("status").notNull().default("NOT_CONFIGURED"),
    displayName: text("display_name"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    credentialsEncrypted: text("credentials_encrypted"),
    connectedAt: ts("connected_at"),
    lastSyncAt: ts("last_sync_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integrations_org_kind_uq").on(t.organizationId, t.kind)],
);

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  kind: integrationKindEnum("kind").notNull(),
  organizationId: orgRef(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    topic: text("topic"),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<unknown>(),
    status: text("status").notNull().default("RECEIVED"),
    error: text("error"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [uniqueIndex("webhook_events_source_ext_uq").on(t.source, t.externalId)],
);

// ── Operations: jobs, automations, agents, AI usage ──────────────────────────
export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatusEnum("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    result: jsonb("result").$type<unknown>(),
    dedupeKey: text("dedupe_key"),
    trigger: text("trigger").notNull().default("MANUAL"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("jobs_claim_idx").on(t.status, t.runAt, t.priority),
    uniqueIndex("jobs_dedupe_active_uq").on(t.dedupeKey).where(sql`dedupe_key is not null and status in ('queued','running')`),
  ],
);

export const jobSchedules = pgTable(
  "job_schedules",
  {
    id: id(),
    organizationId: orgRef(),
    key: text("key").notNull(),
    jobType: text("job_type").notNull(),
    cron: text("cron").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    description: text("description"),
    lastEnqueuedAt: ts("last_enqueued_at"),
    nextRunAt: ts("next_run_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("job_schedules_org_key_uq").on(t.organizationId, t.key)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    jobId: integer("job_id"),
    automation: text("automation").notNull(),
    trigger: text("trigger").notNull(),
    status: runStatusEnum("status").notNull().default("running"),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    durationMs: integer("duration_ms"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("automation_runs_org_started_idx").on(t.organizationId, t.startedAt)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    organizationId: orgRef(),
    agent: text("agent").notNull(),
    parentRunId: uuid("parent_run_id"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
    status: runStatusEnum("status").notNull().default("running"),
    input: jsonb("input").$type<unknown>(),
    output: jsonb("output").$type<unknown>(),
    error: text("error"),
    generationMethod: generationMethodEnum("generation_method"),
    provider: text("provider"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    durationMs: integer("duration_ms"),
    logs: jsonb("logs").$type<Array<{ at: string; level: string; msg: string }>>().notNull().default([]),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("agent_runs_org_created_idx").on(t.organizationId, t.createdAt), index("agent_runs_parent_idx").on(t.parentRunId)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    organizationId: orgRef(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    task: text("task").notNull(),
    tier: text("tier").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    agentRunId: uuid("agent_run_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    cached: boolean("cached").notNull().default(false),
    success: boolean("success").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_org_created_idx").on(t.organizationId, t.createdAt)],
);

export const aiCache = pgTable("ai_cache", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  response: jsonb("response").$type<unknown>().notNull(),
  createdAt: createdAt(),
  expiresAt: ts("expires_at").notNull(),
});

// ── Notifications, audit, settings ───────────────────────────────────────────
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: orgRef(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    severity: severityEnum("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    channels: jsonb("channels").$type<string[]>().notNull().default(["DASHBOARD"]),
    delivery: jsonb("delivery").$type<Record<string, string>>().notNull().default({}),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_org_created_idx").on(t.organizationId, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    actor: text("actor").notNull().default("user"), // user | system | api_key | agent
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt)],
);

export const apiRequestLogs = pgTable(
  "api_request_logs",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    path: text("path").notNull(),
    status: integer("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    actor: text("actor"),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("api_request_logs_created_idx").on(t.createdAt)],
);

export const settings = pgTable(
  "settings",
  {
    organizationId: orgRef(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);

// Row types
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type ProductSource = typeof productSources.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductScore = typeof productScores.$inferSelect;
export type ProductResearch = typeof productResearch.$inferSelect;
export type ProductReview = typeof productReviews.$inferSelect;
export type ProductTest = typeof productTests.$inferSelect;
export type AffiliateNetwork = typeof affiliateNetworks.$inferSelect;
export type AffiliateLink = typeof affiliateLinks.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Content = typeof content.$inferSelect;
export type NewContent = typeof content.$inferInsert;
export type LandingPage = typeof landingPages.$inferSelect;
export type LandingPageSection = typeof landingPageSections.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type Experiment = typeof experiments.$inferSelect;
export type Recommendation = typeof recommendations.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobSchedule = typeof jobSchedules.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
