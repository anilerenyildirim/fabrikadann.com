CREATE TYPE "public"."trendyol_push_status" AS ENUM('pending', 'ok', 'failed');--> statement-breakpoint
CREATE TABLE "trendyol_order_stock" (
	"order_number" text NOT NULL,
	"barcode" text NOT NULL,
	"variant_id" uuid,
	"quantity" integer DEFAULT 0 NOT NULL,
	"deducted" integer DEFAULT 0 NOT NULL,
	"shortfall" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trendyol_order_stock_order_number_barcode_pk" PRIMARY KEY("order_number","barcode")
);
--> statement-breakpoint
CREATE TABLE "trendyol_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"status" text NOT NULL,
	"lines" jsonb NOT NULL,
	"last_modified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trendyol_stock_push" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"barcode" text NOT NULL,
	"quantity" integer NOT NULL,
	"batch_request_id" text,
	"status" "trendyol_push_status" NOT NULL,
	"error" text,
	"pushed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trendyol_order_stock" ADD CONSTRAINT "trendyol_order_stock_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trendyol_stock_push" ADD CONSTRAINT "trendyol_stock_push_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trendyol_order_stock_variant_idx" ON "trendyol_order_stock" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "trendyol_packages_order_idx" ON "trendyol_packages" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_barcode_idx" ON "variants" USING btree ("barcode") WHERE "variants"."barcode" is not null;