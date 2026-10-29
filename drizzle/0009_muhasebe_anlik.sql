ALTER TABLE "purchases" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "trendyol_order_stock" ADD COLUMN "unit_cost" integer;--> statement-breakpoint
ALTER TABLE "trendyol_order_stock" ADD COLUMN "manufacturer_id" uuid;--> statement-breakpoint
ALTER TABLE "trendyol_order_stock" ADD COLUMN "cost_fixed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trendyol_order_stock" ADD CONSTRAINT "trendyol_order_stock_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_request_idx" ON "purchases" USING btree ("request_id");