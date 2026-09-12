CREATE TYPE "public"."affiliate_product_status" AS ENUM('DISCOVERED', 'REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "affiliate_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"network" "affiliate_network_type" NOT NULL,
	"network_id" uuid,
	"merchant" text,
	"marketplace" text NOT NULL,
	"country" text NOT NULL,
	"external_id" text NOT NULL,
	"external_id_type" text DEFAULT 'ASIN' NOT NULL,
	"parent_external_id" text,
	"title" text NOT NULL,
	"description" text,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text,
	"category_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand" text,
	"product_url" text,
	"affiliate_url" text,
	"image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price" numeric(12, 2),
	"currency" text,
	"price_display" text,
	"availability" text DEFAULT 'UNKNOWN' NOT NULL,
	"availability_message" text,
	"rating" double precision,
	"review_count" integer,
	"review_source" text,
	"commission_rate" double precision,
	"network_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "affiliate_product_status" DEFAULT 'DISCOVERED' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"review_note" text,
	"product_id" uuid,
	"ingest_source" text DEFAULT 'api' NOT NULL,
	"provenance" "data_provenance" DEFAULT 'REAL' NOT NULL,
	"data_fetched_at" timestamp with time zone,
	"last_sync_error" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD CONSTRAINT "affiliate_products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD CONSTRAINT "affiliate_products_network_id_affiliate_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."affiliate_networks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD CONSTRAINT "affiliate_products_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD CONSTRAINT "affiliate_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_products_listing_uq" ON "affiliate_products" USING btree ("organization_id","network","marketplace","external_id");--> statement-breakpoint
CREATE INDEX "affiliate_products_org_status_idx" ON "affiliate_products" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "affiliate_products_org_fetched_idx" ON "affiliate_products" USING btree ("organization_id","data_fetched_at");