CREATE TYPE "public"."marketplace_listing_status" AS ENUM('pending', 'active', 'failed');--> statement-breakpoint
CREATE TABLE "marketplace_categories" (
	"channel" text NOT NULL,
	"external_id" bigint NOT NULL,
	"path" text NOT NULL,
	CONSTRAINT "marketplace_categories_channel_external_id_pk" PRIMARY KEY("channel","external_id")
);
--> statement-breakpoint
CREATE TABLE "marketplace_category_map" (
	"channel" text NOT NULL,
	"category_id" uuid NOT NULL,
	"external_category_id" bigint NOT NULL,
	"external_path" text NOT NULL,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_category_map_channel_category_id_pk" PRIMARY KEY("channel","category_id")
);
--> statement-breakpoint
CREATE TABLE "marketplace_listings" (
	"channel" text NOT NULL,
	"variant_id" uuid NOT NULL,
	"stock_code" text NOT NULL,
	"product_id" uuid NOT NULL,
	"status" "marketplace_listing_status" NOT NULL,
	"task_id" text,
	"error" text,
	"pushed_quantity" integer,
	"pushed_price" integer,
	"pushed_at" timestamp with time zone,
	"push_task_id" text,
	"push_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_listings_channel_variant_id_pk" PRIMARY KEY("channel","variant_id")
);
--> statement-breakpoint
CREATE TABLE "marketplace_order_stock" (
	"channel" text NOT NULL,
	"order_number" text NOT NULL,
	"stock_code" text NOT NULL,
	"variant_id" uuid,
	"quantity" integer DEFAULT 0 NOT NULL,
	"deducted" integer DEFAULT 0 NOT NULL,
	"shortfall" integer DEFAULT 0 NOT NULL,
	"unit_cost" integer,
	"manufacturer_id" uuid,
	"cost_fixed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_order_stock_channel_order_number_stock_code_pk" PRIMARY KEY("channel","order_number","stock_code")
);
--> statement-breakpoint
CREATE TABLE "marketplace_packages" (
	"channel" text NOT NULL,
	"id" text NOT NULL,
	"order_number" text NOT NULL,
	"status" text NOT NULL,
	"lines" jsonb NOT NULL,
	"order_date" timestamp with time zone,
	"last_modified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_packages_channel_id_pk" PRIMARY KEY("channel","id")
);
--> statement-breakpoint
CREATE TABLE "marketplace_sync_state" (
	"channel" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_tasks" (
	"channel" text NOT NULL,
	"task_id" text NOT NULL,
	"kind" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	CONSTRAINT "marketplace_tasks_channel_task_id_pk" PRIMARY KEY("channel","task_id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "n11_price" integer;--> statement-breakpoint
ALTER TABLE "marketplace_category_map" ADD CONSTRAINT "marketplace_category_map_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_order_stock" ADD CONSTRAINT "marketplace_order_stock_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_order_stock" ADD CONSTRAINT "marketplace_order_stock_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_listings_stock_code_idx" ON "marketplace_listings" USING btree ("channel","stock_code");--> statement-breakpoint
CREATE INDEX "marketplace_order_stock_variant_idx" ON "marketplace_order_stock" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "marketplace_packages_order_idx" ON "marketplace_packages" USING btree ("channel","order_number");