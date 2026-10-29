CREATE TYPE "public"."ledger_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."purchase_kind" AS ENUM('purchase', 'return');--> statement-breakpoint
ALTER TYPE "public"."stock_reason" ADD VALUE 'purchase';--> statement-breakpoint
ALTER TYPE "public"."stock_reason" ADD VALUE 'supplier_return';--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"category" text NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"method" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"manufacturer_id" uuid,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "manufacturers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"tax_office" text DEFAULT '' NOT NULL,
	"tax_number" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"iban" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_item_costs" (
	"order_item_id" uuid PRIMARY KEY NOT NULL,
	"manufacturer_id" uuid,
	"unit_cost" integer
);
--> statement-breakpoint
CREATE TABLE "product_supply" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"manufacturer_id" uuid,
	"purchase_price" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_supply_price_non_negative" CHECK ("product_supply"."purchase_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"variant_id" uuid,
	"product_id" uuid,
	"product_name" text NOT NULL,
	"color_name" text NOT NULL,
	"size" text NOT NULL,
	"production_barcode" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" integer NOT NULL,
	CONSTRAINT "purchase_items_quantity_positive" CHECK ("purchase_items"."quantity" > 0),
	CONSTRAINT "purchase_items_cost_non_negative" CHECK ("purchase_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "purchases_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" "purchase_kind" NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"total" integer NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_total_non_negative" CHECK ("purchases"."total" >= 0)
);
--> statement-breakpoint
-- Üretim barkodu: "29" + 10 haneli sıra + EAN-13 kontrol hanesi (mağaza içi aralık, GS1 kodlarıyla çakışmaz)
CREATE SEQUENCE "production_barcode_seq";--> statement-breakpoint
CREATE FUNCTION next_production_barcode() RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  body text := '29' || lpad(nextval('production_barcode_seq')::text, 10, '0');
  s int := 0;
BEGIN
  FOR i IN 1..12 LOOP
    s := s + substr(body, i, 1)::int * (CASE WHEN i % 2 = 0 THEN 3 ELSE 1 END);
  END LOOP;
  RETURN body || ((10 - s % 10) % 10)::text;
END
$$;--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "production_barcode" text DEFAULT next_production_barcode() NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_costs" ADD CONSTRAINT "order_item_costs_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_costs" ADD CONSTRAINT "order_item_costs_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_supply" ADD CONSTRAINT "product_supply_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_supply" ADD CONSTRAINT "product_supply_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_date_idx" ON "ledger_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "ledger_entries_manufacturer_idx" ON "ledger_entries" USING btree ("manufacturer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturers_name_idx" ON "manufacturers" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "order_item_costs_manufacturer_idx" ON "order_item_costs" USING btree ("manufacturer_id");--> statement-breakpoint
CREATE INDEX "product_supply_manufacturer_idx" ON "product_supply" USING btree ("manufacturer_id");--> statement-breakpoint
CREATE INDEX "purchase_items_purchase_idx" ON "purchase_items" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_items_variant_idx" ON "purchase_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "purchase_items_product_idx" ON "purchase_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_number_idx" ON "purchases" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchases_manufacturer_idx" ON "purchases" USING btree ("manufacturer_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_production_barcode_idx" ON "variants" USING btree ("production_barcode");