ALTER TYPE "public"."stock_reason" ADD VALUE 'n11';--> statement-breakpoint
ALTER TABLE "marketplace_listings" DROP CONSTRAINT "marketplace_listings_variant_id_variants_id_fk";
--> statement-breakpoint
DROP INDEX "marketplace_listings_stock_code_idx";--> statement-breakpoint
ALTER TABLE "marketplace_listings" DROP CONSTRAINT "marketplace_listings_channel_variant_id_pk";--> statement-breakpoint
ALTER TABLE "marketplace_listings" ALTER COLUMN "variant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_channel_stock_code_pk" PRIMARY KEY("channel","stock_code");--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_listings_variant_idx" ON "marketplace_listings" USING btree ("channel","variant_id") WHERE "marketplace_listings"."variant_id" is not null;