CREATE TYPE "public"."cancel_reason" AS ENUM('payment_expired', 'admin');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" "cancel_reason";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_session" text;--> statement-breakpoint
CREATE INDEX "orders_open_ip_idx" ON "orders" USING btree ("terms_accepted_ip","status");--> statement-breakpoint
CREATE INDEX "orders_open_email_idx" ON "orders" USING btree ("email","status");