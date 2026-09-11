CREATE TYPE "public"."affiliate_network_type" AS ENUM('IMPACT', 'AWIN', 'SHAREASALE', 'PARTNERSTACK', 'RAKUTEN', 'AMAZON_ASSOCIATES', 'CJ_AFFILIATE', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."article_status" AS ENUM('IDEA', 'DRAFT', 'PUBLISHED');--> statement-breakpoint
CREATE TYPE "public"."article_type" AS ENUM('LISTICLE', 'BEST_FOR', 'VERSUS', 'ALTERNATIVES', 'GUIDE');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('IMAGE', 'VIDEO', 'UGC', 'THUMBNAIL', 'LOGO', 'CREATIVE_VARIANT');--> statement-breakpoint
CREATE TYPE "public"."business_model" AS ENUM('AFFILIATE', 'DROPSHIPPING', 'SHOPIFY', 'LANDING_PAGE');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('PENDING', 'APPROVED', 'PAID', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."content_angle" AS ENUM('CURIOSITY', 'PROBLEM_SOLUTION', 'BEFORE_AFTER', 'POV', 'UNEXPECTED_USE', 'COMPARISON', 'EXPERIMENT', 'CHALLENGE', 'REACTION', 'EDUCATIONAL', 'UGC', 'UNBOXING', 'REVIEW', 'MYTH_BUSTING');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('IDEA', 'SCRIPTED', 'ASSET_READY', 'SCHEDULED', 'PUBLISHED', 'ANALYZING', 'WINNER', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('TIKTOK_VIDEO', 'INSTAGRAM_REEL', 'YOUTUBE_SHORT', 'PINTEREST_PIN', 'STATIC_POST', 'CAROUSEL', 'EDUCATIONAL_POST', 'PROBLEM_SOLUTION_POST', 'AD_CONCEPT', 'EMAIL', 'ARTICLE');--> statement-breakpoint
CREATE TYPE "public"."conversion_type" AS ENUM('PURCHASE', 'LEAD', 'CHECKOUT_STARTED');--> statement-breakpoint
CREATE TYPE "public"."product_decision" AS ENUM('SCALE', 'TEST_MORE', 'OPTIMIZE', 'CONTENT_MORE', 'PAUSE', 'KILL');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('PAGE_VIEW', 'PRODUCT_VIEW', 'PRODUCT_CLICK', 'AFFILIATE_CLICK', 'CHECKOUT', 'SOCIAL_CLICK', 'NEWSLETTER_SIGNUP');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('DRAFT', 'RUNNING', 'COMPLETED', 'STOPPED');--> statement-breakpoint
CREATE TYPE "public"."experiment_type" AS ENUM('HEADLINE', 'HERO_IMAGE', 'CTA', 'PRICE', 'ANGLE', 'STRUCTURE', 'OFFER', 'VIDEO_HOOK');--> statement-breakpoint
CREATE TYPE "public"."generation_method" AS ENUM('AI', 'TEMPLATE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('SHOPIFY', 'TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'PINTEREST', 'FACEBOOK', 'X', 'EMAIL', 'TELEGRAM');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('NOT_CONFIGURED', 'CONNECTED', 'ERROR', 'DEMO', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."landing_template" AS ENUM('PROBLEM_SOLUTION', 'VIRAL', 'PREMIUM', 'IMPULSE', 'UGC');--> statement-breakpoint
CREATE TYPE "public"."link_status" AS ENUM('UNCHECKED', 'ACTIVE', 'BROKEN', 'PAUSED');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('NEW_OPPORTUNITY', 'PRODUCT_WINNER', 'PRODUCT_KILL', 'LINK_BROKEN', 'TRAFFIC_SPIKE', 'CONVERSION_SPIKE', 'INVENTORY_UNAVAILABLE', 'REPORT_READY', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."page_status" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'PINTEREST', 'FACEBOOK', 'X', 'EMAIL', 'BLOG', 'WEB', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('DISCOVERED', 'RESEARCHING', 'APPROVED', 'TESTING', 'WINNER', 'SCALING', 'PAUSED', 'KILLED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."data_provenance" AS ENUM('REAL', 'ESTIMATED', 'AI_INFERENCE', 'MANUAL', 'DEMO');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('OPEN', 'DONE', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."section_type" AS ENUM('HERO', 'PROBLEM', 'SOLUTION', 'BENEFITS', 'FEATURES', 'HOW_IT_WORKS', 'DEMO', 'COMPARISON', 'SOCIAL_PROOF', 'FAQ', 'CTA', 'TRUST', 'SHIPPING', 'RETURNS', 'DISCLOSURE');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'success', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."source_adapter" AS ENUM('MANUAL_IMPORT', 'SHOPIFY_SUPPLIER', 'ALIEXPRESS', 'CJ', 'DSERS', 'AFFILIATE_NETWORK', 'AMAZON', 'TIKTOK_SHOP', 'SOCIAL_TREND', 'WIKIPEDIA_TRENDS', 'DEMO');--> statement-breakpoint
CREATE TYPE "public"."store_type" AS ENUM('STOREFRONT', 'SHOPIFY', 'AFFILIATE_PROJECT', 'LANDING');--> statement-breakpoint
CREATE TYPE "public"."test_verdict" AS ENUM('WINNER', 'PROMISING', 'FAILURE', 'INSUFFICIENT_DATA');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'operator', 'viewer');--> statement-breakpoint
CREATE TABLE "affiliate_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"network_id" uuid,
	"product_id" uuid,
	"merchant" text,
	"url" text NOT NULL,
	"code" text NOT NULL,
	"commission_rate" double precision,
	"commission_flat" numeric(12, 2),
	"cookie_days" integer,
	"country" text,
	"is_primary" boolean DEFAULT true NOT NULL,
	"status" "link_status" DEFAULT 'UNCHECKED' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_status_code" integer,
	"last_error" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" "affiliate_network_type" NOT NULL,
	"status" "integration_status" DEFAULT 'NOT_CONFIGURED' NOT NULL,
	"website" text,
	"default_cookie_days" integer,
	"sub_id_param" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_encrypted" text,
	"postback_secret_encrypted" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"parent_run_id" uuid,
	"product_id" uuid,
	"triggered_by" uuid,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"generation_method" "generation_method",
	"provider" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"tier" text NOT NULL,
	"product_id" uuid,
	"agent_run_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_request_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"actor" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"type" "article_type" DEFAULT 'GUIDE' NOT NULL,
	"status" "article_status" DEFAULT 'IDEA' NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body" jsonb DEFAULT '{"blocks":[]}'::jsonb NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seo_title" text,
	"meta_description" text,
	"generation_method" "generation_method" DEFAULT 'MANUAL' NOT NULL,
	"published_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"actor" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"job_id" integer,
	"automation" text NOT NULL,
	"trigger" text NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"product_id" uuid,
	"platform" "platform" DEFAULT 'TIKTOK' NOT NULL,
	"objective" text,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"utm_source" text NOT NULL,
	"utm_medium" text DEFAULT 'organic' NOT NULL,
	"utm_campaign" text NOT NULL,
	"budget" numeric(12, 2),
	"spend" numeric(12, 2) DEFAULT 0 NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"description" text,
	"icon" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "click_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" "event_type" NOT NULL,
	"product_id" uuid,
	"affiliate_link_id" uuid,
	"campaign_id" uuid,
	"content_id" uuid,
	"landing_page_id" uuid,
	"experiment_id" uuid,
	"variant" text,
	"visitor_id" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"referrer" text,
	"path" text,
	"country" text,
	"device" text,
	"ip_hash" text,
	"user_agent" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"network_id" uuid,
	"affiliate_link_id" uuid,
	"product_id" uuid,
	"conversion_event_id" uuid,
	"external_id" text,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "commission_status" DEFAULT 'PENDING' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid,
	"campaign_id" uuid,
	"platform" "platform" NOT NULL,
	"content_type" "content_type" NOT NULL,
	"angle" "content_angle",
	"title" text NOT NULL,
	"hook" text,
	"script" jsonb,
	"body" text,
	"caption" text,
	"cta" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "content_status" DEFAULT 'IDEA' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"external_post_id" text,
	"external_url" text,
	"utm_content" text,
	"tracking_link_id" uuid,
	"sponsored_disclosure" text,
	"generation_method" "generation_method" DEFAULT 'MANUAL' NOT NULL,
	"model" text,
	"agent_run_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_id" uuid,
	"product_id" uuid,
	"kind" "asset_kind" NOT NULL,
	"url" text,
	"storage_key" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"duration_seconds" double precision,
	"provider" text DEFAULT 'URL' NOT NULL,
	"prompt" text,
	"status" text DEFAULT 'READY' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"date" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"profile_visits" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"product_page_visits" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"revenue" numeric(12, 2) DEFAULT 0 NOT NULL,
	"commission" numeric(12, 2) DEFAULT 0 NOT NULL,
	"cost" numeric(12, 2) DEFAULT 0 NOT NULL,
	"provenance" "data_provenance" DEFAULT 'MANUAL' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "conversion_type" DEFAULT 'PURCHASE' NOT NULL,
	"product_id" uuid,
	"affiliate_link_id" uuid,
	"click_event_id" uuid,
	"campaign_id" uuid,
	"content_id" uuid,
	"order_id" uuid,
	"source" text NOT NULL,
	"external_id" text,
	"revenue" numeric(12, 2) DEFAULT 0 NOT NULL,
	"commission" numeric(12, 2) DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"utm_source" text,
	"utm_campaign" text,
	"utm_content" text,
	"country" text,
	"provenance" "data_provenance" DEFAULT 'REAL' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid,
	"landing_page_id" uuid,
	"name" text NOT NULL,
	"type" "experiment_type" NOT NULL,
	"status" "experiment_status" DEFAULT 'DRAFT' NOT NULL,
	"hypothesis" text,
	"primary_metric" text DEFAULT 'AFFILIATE_CTR' NOT NULL,
	"variants" jsonb NOT NULL,
	"winner_variant" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"status" "integration_status" DEFAULT 'NOT_CONFIGURED' NOT NULL,
	"display_name" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_encrypted" text,
	"connected_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"job_type" text NOT NULL,
	"cron" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"last_enqueued_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"result" jsonb,
	"dedupe_key" text,
	"trigger" text DEFAULT 'MANUAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "landing_page_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"landing_page_id" uuid NOT NULL,
	"type" "section_type" NOT NULL,
	"position" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"variant_key" text,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landing_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"store_id" uuid,
	"slug" text NOT NULL,
	"template" "landing_template" DEFAULT 'PROBLEM_SOLUTION' NOT NULL,
	"status" "page_status" DEFAULT 'DRAFT' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"headline" text NOT NULL,
	"subheadline" text,
	"seo_title" text NOT NULL,
	"meta_description" text NOT NULL,
	"canonical_path" text,
	"og_image" text,
	"cta_label" text DEFAULT 'Check price' NOT NULL,
	"generation_method" "generation_method" DEFAULT 'MANUAL' NOT NULL,
	"model" text,
	"agent_run_id" uuid,
	"published_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"source" text,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"type" "notification_type" NOT NULL,
	"severity" "severity" DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"channels" jsonb DEFAULT '["DASHBOARD"]'::jsonb NOT NULL,
	"delivery" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid,
	"product_id" uuid,
	"source" text NOT NULL,
	"external_order_id" text,
	"status" text DEFAULT 'PAID' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"revenue" numeric(12, 2) DEFAULT 0 NOT NULL,
	"cost" numeric(12, 2) DEFAULT 0 NOT NULL,
	"shipping_cost" numeric(12, 2) DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"country" text,
	"utm_source" text,
	"utm_campaign" text,
	"utm_content" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"default_market" text DEFAULT 'US' NOT NULL,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"decision" "product_decision" NOT NULL,
	"verdict" "test_verdict",
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"date" date NOT NULL,
	"page_views" integer DEFAULT 0 NOT NULL,
	"product_clicks" integer DEFAULT 0 NOT NULL,
	"affiliate_clicks" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"revenue" numeric(12, 2) DEFAULT 0 NOT NULL,
	"commission" numeric(12, 2) DEFAULT 0 NOT NULL,
	"cost" numeric(12, 2) DEFAULT 0 NOT NULL,
	"provenance" "data_provenance" DEFAULT 'REAL' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_research" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"verdict" text NOT NULL,
	"thesis" text NOT NULL,
	"anti_thesis" text NOT NULL,
	"why_trending" text,
	"demand" text,
	"competition" text,
	"pricing" jsonb,
	"supplier_notes" text,
	"shipping_notes" text,
	"social_potential" text,
	"content_opportunity" text,
	"target_customer" text,
	"marketing_angles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hooks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ctas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"landing_angle" text,
	"risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_level" "risk_level" DEFAULT 'MEDIUM' NOT NULL,
	"recommended_action" text,
	"source_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation_method" "generation_method" NOT NULL,
	"provenance" "data_provenance" NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"author_display" text,
	"rating" double precision,
	"body" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"overall" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"factors" jsonb NOT NULL,
	"weights" jsonb NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_level" "risk_level" DEFAULT 'LOW' NOT NULL,
	"engine_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"signal" text NOT NULL,
	"value" double precision NOT NULL,
	"provenance" "data_provenance" NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"adapter" "source_adapter" NOT NULL,
	"name" text NOT NULL,
	"status" "integration_status" DEFAULT 'NOT_CONFIGURED' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_encrypted" text,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"last_result_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_stores" (
	"product_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_stores_product_id_store_id_pk" PRIMARY KEY("product_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "product_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"planned_days" integer DEFAULT 14 NOT NULL,
	"ended_at" timestamp with time zone,
	"verdict" "test_verdict",
	"decision" "product_decision",
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"category_id" uuid,
	"subcategory_id" uuid,
	"brand" text,
	"supplier_id" uuid,
	"supplier_url" text,
	"product_url" text,
	"affiliate_url" text,
	"image_url" text,
	"gallery" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shopify_product_id" text,
	"source" "source_adapter" DEFAULT 'MANUAL_IMPORT' NOT NULL,
	"source_id" uuid,
	"source_product_id" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"cost" numeric(12, 2),
	"selling_price" numeric(12, 2),
	"affiliate_commission" numeric(12, 2),
	"commission_percentage" double precision,
	"estimated_margin" double precision,
	"shipping_cost" numeric(12, 2),
	"shipping_days_min" integer,
	"shipping_days_max" integer,
	"countries_available" text[] DEFAULT '{}'::text[] NOT NULL,
	"rating" double precision,
	"review_count" integer,
	"review_growth" double precision,
	"estimated_sales" integer,
	"sales_velocity" double precision,
	"seller_count" integer,
	"ad_activity" double precision,
	"trend_keyword" text,
	"trend_score" double precision,
	"competition_score" double precision,
	"content_score" double precision,
	"impulse_score" double precision,
	"margin_score" double precision,
	"problem_score" double precision,
	"novelty_score" double precision,
	"saturation_score" double precision,
	"shipping_score" double precision,
	"overall_score" double precision,
	"score_confidence" double precision,
	"risk_level" "risk_level",
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "product_status" DEFAULT 'DISCOVERED' NOT NULL,
	"business_model" "business_model" DEFAULT 'AFFILIATE' NOT NULL,
	"business_models" jsonb DEFAULT '["AFFILIATE"]'::jsonb NOT NULL,
	"target_audience" text,
	"problem_solved" text,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid,
	"type" text NOT NULL,
	"fingerprint" text NOT NULL,
	"priority" "priority" DEFAULT 'MEDIUM' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"action" jsonb,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "recommendation_status" DEFAULT 'OPEN' NOT NULL,
	"source" text DEFAULT 'RULES' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"content" jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_organization_id_key_pk" PRIMARY KEY("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" "store_type" DEFAULT 'STOREFRONT' NOT NULL,
	"domain" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"market" text DEFAULT 'US' NOT NULL,
	"shopify_domain" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"adapter" "source_adapter" DEFAULT 'MANUAL_IMPORT' NOT NULL,
	"website" text,
	"shipping_days_min" integer,
	"shipping_days_max" integer,
	"rating" double precision,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"topic" text,
	"organization_id" uuid,
	"payload" jsonb,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_network_id_affiliate_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."affiliate_networks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_networks" ADD CONSTRAINT "affiliate_networks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_affiliate_link_id_affiliate_links_id_fk" FOREIGN KEY ("affiliate_link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_landing_page_id_landing_pages_id_fk" FOREIGN KEY ("landing_page_id") REFERENCES "public"."landing_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_network_id_affiliate_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."affiliate_networks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_affiliate_link_id_affiliate_links_id_fk" FOREIGN KEY ("affiliate_link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_conversion_event_id_conversion_events_id_fk" FOREIGN KEY ("conversion_event_id") REFERENCES "public"."conversion_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_tracking_link_id_affiliate_links_id_fk" FOREIGN KEY ("tracking_link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_metrics" ADD CONSTRAINT "content_metrics_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_affiliate_link_id_affiliate_links_id_fk" FOREIGN KEY ("affiliate_link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_landing_page_id_landing_pages_id_fk" FOREIGN KEY ("landing_page_id") REFERENCES "public"."landing_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_schedules" ADD CONSTRAINT "job_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_page_sections" ADD CONSTRAINT "landing_page_sections_landing_page_id_landing_pages_id_fk" FOREIGN KEY ("landing_page_id") REFERENCES "public"."landing_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_decisions" ADD CONSTRAINT "product_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_decisions" ADD CONSTRAINT "product_decisions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_metrics" ADD CONSTRAINT "product_metrics_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research" ADD CONSTRAINT "product_research_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_scores" ADD CONSTRAINT "product_scores_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_signals" ADD CONSTRAINT "product_signals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sources" ADD CONSTRAINT "product_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_stores" ADD CONSTRAINT "product_stores_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_stores" ADD CONSTRAINT "product_stores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tests" ADD CONSTRAINT "product_tests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tests" ADD CONSTRAINT "product_tests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_subcategory_id_categories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_id_product_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."product_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_links_code_uq" ON "affiliate_links" USING btree ("code");--> statement-breakpoint
CREATE INDEX "affiliate_links_product_idx" ON "affiliate_links" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_networks_org_slug_uq" ON "affiliate_networks" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "agent_runs_org_created_idx" ON "agent_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_parent_idx" ON "agent_runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "ai_usage_org_created_idx" ON "ai_usage" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_request_logs_created_idx" ON "api_request_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_org_slug_uq" ON "articles" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_runs_org_started_idx" ON "automation_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_org_slug_uq" ON "campaigns" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_org_slug_uq" ON "categories" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "click_events_org_created_idx" ON "click_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "click_events_product_created_idx" ON "click_events" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "click_events_type_idx" ON "click_events" USING btree ("organization_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "click_events_utm_content_idx" ON "click_events" USING btree ("organization_id","utm_content");--> statement-breakpoint
CREATE INDEX "commissions_org_time_idx" ON "commissions" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "content_org_status_idx" ON "content" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "content_product_idx" ON "content" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "content_scheduled_idx" ON "content" USING btree ("organization_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_product_utm_content_uq" ON "content" USING btree ("product_id","utm_content") WHERE utm_content is not null;--> statement-breakpoint
CREATE INDEX "content_assets_content_idx" ON "content_assets" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "content_assets_product_idx" ON "content_assets" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_metrics_content_date_uq" ON "content_metrics" USING btree ("content_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "conversion_events_source_ext_uq" ON "conversion_events" USING btree ("organization_id","source","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE INDEX "conversion_events_org_time_idx" ON "conversion_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "conversion_events_product_idx" ON "conversion_events" USING btree ("product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "experiments_lp_idx" ON "experiments" USING btree ("landing_page_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_kind_uq" ON "integrations" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "job_schedules_org_key_uq" ON "job_schedules" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_active_uq" ON "jobs" USING btree ("dedupe_key") WHERE dedupe_key is not null and status in ('queued','running');--> statement-breakpoint
CREATE INDEX "landing_page_sections_page_idx" ON "landing_page_sections" USING btree ("landing_page_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "landing_pages_org_slug_uq" ON "landing_pages" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "landing_pages_product_idx" ON "landing_pages" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_org_email_uq" ON "newsletter_subscribers" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "notifications_org_created_idx" ON "notifications" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_source_ext_uq" ON "orders" USING btree ("organization_id","source","external_order_id") WHERE external_order_id is not null;--> statement-breakpoint
CREATE INDEX "orders_org_time_idx" ON "orders" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "product_decisions_product_idx" ON "product_decisions" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_metrics_product_date_uq" ON "product_metrics" USING btree ("product_id","date");--> statement-breakpoint
CREATE INDEX "product_research_product_idx" ON "product_research" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "product_reviews_product_idx" ON "product_reviews" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_scores_product_idx" ON "product_scores" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "product_signals_product_signal_idx" ON "product_signals" USING btree ("product_id","signal","observed_at");--> statement-breakpoint
CREATE INDEX "product_tests_product_idx" ON "product_tests" USING btree ("product_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_slug_uq" ON "products" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "products_org_status_idx" ON "products" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "products_org_score_idx" ON "products" USING btree ("organization_id","overall_score");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_source_uq" ON "products" USING btree ("organization_id","source","source_product_id") WHERE source_product_id is not null;--> statement-breakpoint
CREATE INDEX "recommendations_org_status_idx" ON "recommendations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_open_fp_uq" ON "recommendations" USING btree ("organization_id","fingerprint") WHERE status = 'OPEN';--> statement-breakpoint
CREATE INDEX "reports_org_type_idx" ON "reports" USING btree ("organization_id","type","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_org_slug_uq" ON "stores" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_source_ext_uq" ON "webhook_events" USING btree ("source","external_id");