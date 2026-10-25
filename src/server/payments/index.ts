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

export function getPaymentProvider(): PaymentProvider {
  switch (process.env.PAYMENT_PROVIDER ?? "mock") {
    case "mock":
      return mockProvider;
    case "iyzico":
      // iyzico anlaşması yapılınca Checkout Form adaptörü buraya eklenecek
      throw new Error("iyzico entegrasyonu henüz eklenmedi");
    default:
      throw new Error(`Bilinmeyen ödeme sağlayıcısı: ${process.env.PAYMENT_PROVIDER}`);
  }
}

export const isMockPayments = () => (process.env.PAYMENT_PROVIDER ?? "mock") === "mock";
