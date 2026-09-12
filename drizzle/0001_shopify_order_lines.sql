DROP INDEX "orders_source_ext_uq";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "external_line_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_amount" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_source_ext_line_uq" ON "orders" USING btree ("organization_id","source","external_order_id","external_line_id") WHERE external_order_id is not null;