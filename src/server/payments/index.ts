import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { createIyzicoProvider } from "./iyzico";
import type { PaymentProvider } from "./provider";

/**
 * Geliştirme için sahte ödeme: müşteriyi sitedeki test ödeme sayfasına gönderir.
 * Canlıda bu sayfa yalnızca yöneticiye çalışır (bkz. app/api/odeme/mock).
 */
const mockProvider: PaymentProvider = {
  name: "mock",
  async start({ token }) {
    return { redirectUrl: `/odeme/test/${token}` };
  },
};

async function shippingFeeOf(orderId: string): Promise<number> {
  const [row] = await db
    .select({ fee: schema.orders.shippingFee })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId));
  return row?.fee ?? 0;
}

export function getPaymentProvider(): PaymentProvider {
  switch (process.env.PAYMENT_PROVIDER ?? "mock") {
    case "mock":
      return mockProvider;
    case "iyzico":
      return createIyzicoProvider(shippingFeeOf);
    default:
      throw new Error(`Bilinmeyen ödeme sağlayıcısı: ${process.env.PAYMENT_PROVIDER}`);
  }
}

export const isMockPayments = () => (process.env.PAYMENT_PROVIDER ?? "mock") === "mock";
