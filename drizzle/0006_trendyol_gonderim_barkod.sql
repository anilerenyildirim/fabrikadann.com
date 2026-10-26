-- Gönderim kaydı barkoda bağlanır. Eski kayıtlar silinir: sonraki senkron tüm barkodları baştan gönderir.
DELETE FROM "trendyol_stock_push";--> statement-breakpoint
ALTER TABLE "trendyol_stock_push" DROP CONSTRAINT "trendyol_stock_push_variant_id_variants_id_fk";--> statement-breakpoint
ALTER TABLE "trendyol_stock_push" DROP CONSTRAINT "trendyol_stock_push_pkey";--> statement-breakpoint
ALTER TABLE "trendyol_stock_push" ADD PRIMARY KEY ("barcode");--> statement-breakpoint
ALTER TABLE "trendyol_stock_push" ALTER COLUMN "variant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trendyol_stock_push" ADD CONSTRAINT "trendyol_stock_push_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;
