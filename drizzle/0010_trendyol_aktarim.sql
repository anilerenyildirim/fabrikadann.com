ALTER TABLE "products" ADD COLUMN "trendyol_sale_price" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "trendyol_discount" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "trendyol_main_id" text;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "trendyol_imported_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "products_trendyol_main_id_idx" ON "products" USING btree ("trendyol_main_id") WHERE "products"."trendyol_main_id" is not null;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_trendyol_discount_range" CHECK ("products"."trendyol_discount" between 0 and 90);