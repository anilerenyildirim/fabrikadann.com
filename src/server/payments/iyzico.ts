import { createHmac, randomBytes } from "node:crypto";
import type { PaymentProvider, PaymentStartInput } from "./provider";
import type { PaymentOutcome } from "@/server/services/payments";

/**
 * iyzico Checkout Form (ortak ödeme sayfası) adaptörü.
 * Akış: start → iyzico'nun ödeme sayfasına yönlendirme → iyzico, callbackUrl'e `token` POST eder →
 * retrieveOutcome(token) sonucu iyzico API'sinden SUNUCUDAN SUNUCUYA sorgular (callback gövdesine güvenilmez).
 *
 * Gerekli ortam değişkenleri: IYZICO_API_KEY, IYZICO_SECRET_KEY,
 * IYZICO_BASE_URL (sandbox: https://sandbox-api.iyzipay.com, canlı: https://api.iyzipay.com)
 */

const INIT_PATH = "/payment/iyzipos/checkoutform/initialize/auth/ecom";
const DETAIL_PATH = "/payment/iyzipos/checkoutform/auth/ecom/detail";

type Config = { apiKey: string; secretKey: string; baseUrl: string };

function config(): Config {
  const apiKey = process.env.IYZICO_API_KEY;
  const secretKey = process.env.IYZICO_SECRET_KEY;
  const baseUrl = process.env.IYZICO_BASE_URL;
  if (!apiKey || !secretKey || !baseUrl) throw new Error("iyzico ortam değişkenleri eksik");
  return { apiKey, secretKey, baseUrl: baseUrl.replace(/\/$/, "") };
}

/** IYZWSv2 Authorization başlığı. */
export function iyzicoAuthHeader(cfg: Pick<Config, "apiKey" | "secretKey">, randomKey: string, path: string, body: string) {
  const signature = createHmac("sha256", cfg.secretKey).update(randomKey + path + body).digest("hex");
  const auth = `apiKey:${cfg.apiKey}&randomKey:${randomKey}&signature:${signature}`;
  return `IYZWSv2 ${Buffer.from(auth).toString("base64")}`;
}

/** Kuruş → iyzico'nun beklediği "1299.90" biçimi. */
export const toIyzicoPrice = (kurus: number) => (kurus / 100).toFixed(2);

/** "1299.9" → 129990 kuruş */
export const fromIyzicoPrice = (value: string | number) => Math.round(Number(value) * 100);

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const surname = parts.length > 1 ? parts.pop()! : parts[0]!;
  return { name: parts.join(" ") || surname, surname };
}

/** Checkout Form başlatma gövdesi. Sepet kalemlerinin toplamı fiyata eşit olmalıdır. */
export function buildInitializeRequest(input: PaymentStartInput, shippingFee: number) {
  const { order } = input;
  const { name, surname } = splitName(order.address.fullName);
  const address = `${order.address.line}, ${order.address.district}/${order.address.city}`;
  const basketItems = order.items.map((item, i) => ({
    id: item.sku || `kalem-${i + 1}`,
    name: item.name.slice(0, 100),
    category1: "Ayakkabı",
    itemType: "PHYSICAL",
    // iyzico'da kalem fiyatı adet × birim fiyattır
    price: toIyzicoPrice(item.unitPrice * item.quantity),
  }));
  if (shippingFee > 0) {
    basketItems.push({ id: "KARGO", name: "Kargo", category1: "Kargo", itemType: "PHYSICAL", price: toIyzicoPrice(shippingFee) });
  }
  return {
    locale: "tr",
    conversationId: input.token,
    price: toIyzicoPrice(order.total),
    paidPrice: toIyzicoPrice(order.total),
    currency: "TRY",
    basketId: order.number,
    paymentGroup: "PRODUCT",
    callbackUrl: input.callbackUrl,
    enabledInstallments: [1, 2, 3, 6],
    buyer: {
      id: order.email,
      name,
      surname,
      gsmNumber: `+9${order.address.phone}`,
      email: order.email,
      // T.C. kimlik no istenmiyor; iyzico'nun önerdiği yer tutucu
      identityNumber: "11111111111",
      registrationAddress: address,
      ip: order.ip,
      city: order.address.city,
      country: "Turkey",
    },
    shippingAddress: { contactName: order.address.fullName, city: order.address.city, country: "Turkey", address },
    billingAddress: { contactName: order.address.fullName, city: order.address.city, country: "Turkey", address },
    basketItems,
  };
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const cfg = config();
  const json = JSON.stringify(body);
  const randomKey = `${Date.now()}${randomBytes(8).toString("hex")}`;
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-iyzi-rnd": randomKey,
      Authorization: iyzicoAuthHeader(cfg, randomKey, path, json),
    },
    body: json,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`iyzico HTTP ${res.status}`);
  return (await res.json()) as T;
}

type InitResponse = { status: string; errorMessage?: string; paymentPageUrl?: string; token?: string };

type DetailResponse = {
  status: string;
  errorMessage?: string;
  paymentStatus?: string;
  fraudStatus?: number;
  price?: number;
  paidPrice?: number;
  basketId?: string;
  conversationId?: string;
  paymentId?: string;
};

export function createIyzicoProvider(getShippingFee: (orderId: string) => Promise<number>): PaymentProvider {
  return {
    name: "iyzico",
    async start(input) {
      const body = buildInitializeRequest(input, await getShippingFee(input.order.id));
      const res = await call<InitResponse>(INIT_PATH, body);
      if (res.status !== "success" || !res.paymentPageUrl || !res.token) {
        console.error("iyzico başlatma hatası", res.errorMessage);
        throw new Error("Ödeme sayfası açılamadı");
      }
      return { redirectUrl: res.paymentPageUrl, providerSessionId: res.token };
    },
  };
}

/** Callback'teki iyzico token'ı ile ödemenin gerçek sonucunu iyzico'dan sorgular. */
export async function retrieveIyzicoOutcome(iyzicoToken: string): Promise<PaymentOutcome | null> {
  if (!/^[A-Za-z0-9-]{10,100}$/.test(iyzicoToken)) return null;
  const res = await call<DetailResponse>(DETAIL_PATH, { locale: "tr", token: iyzicoToken });
  if (res.status !== "success" || !res.conversationId || res.price === undefined) return null;
  // Henüz sonuçlanmamış (3DS sürüyor) ya da dolandırıcılık incelemesinde: karar verme, sonra yeniden sorgulanır
  if (res.paymentStatus !== "SUCCESS" && res.paymentStatus !== "FAILURE") return null;
  if (res.paymentStatus === "SUCCESS" && res.fraudStatus === 0) return null;
  return {
    token: res.conversationId,
    // fraudStatus: 1 onaylı, 0 incelemede, -1 reddedildi
    success: res.paymentStatus === "SUCCESS" && res.fraudStatus === 1,
    // Taksit farkı paidPrice'a eklenir; sipariş tutarıyla price karşılaştırılır
    amount: fromIyzicoPrice(res.price),
    providerRef: res.paymentId ?? null,
    raw: { paymentStatus: res.paymentStatus, fraudStatus: res.fraudStatus, basketId: res.basketId, paidPrice: res.paidPrice },
  };
}
