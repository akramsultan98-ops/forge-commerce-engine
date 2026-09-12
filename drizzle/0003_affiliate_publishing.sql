ALTER TYPE "public"."event_type" ADD VALUE 'REDIRECT_FALLBACK';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'automation';--> statement-breakpoint
ALTER TABLE "affiliate_products" ALTER COLUMN "external_id_type" SET DEFAULT 'ID';--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD COLUMN "affiliate_product_id" uuid;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "problem_solved" text;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "target_audience" text;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "expected_commission_rate" double precision;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "score" double precision;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "score_provenance" "data_provenance";--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "score_source" text;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "score_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "scored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "click_events" ADD COLUMN "affiliate_product_id" uuid;--> statement-breakpoint
ALTER TABLE "click_events" ADD COLUMN "destination_host" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "external_data_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price_as_of" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_affiliate_product_id_affiliate_products_id_fk" FOREIGN KEY ("affiliate_product_id") REFERENCES "public"."affiliate_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affiliate_products" ADD CONSTRAINT "affiliate_products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_affiliate_product_id_affiliate_products_id_fk" FOREIGN KEY ("affiliate_product_id") REFERENCES "public"."affiliate_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliate_links_listing_idx" ON "affiliate_links" USING btree ("affiliate_product_id");--> statement-breakpoint
CREATE INDEX "affiliate_products_product_idx" ON "affiliate_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "click_events_listing_created_idx" ON "click_events" USING btree ("affiliate_product_id","created_at");