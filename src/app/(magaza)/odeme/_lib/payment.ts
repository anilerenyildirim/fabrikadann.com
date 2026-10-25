import "server-only";
import { createHash } from "node:crypto";
import { getSession } from "@/server/auth/current";
import { isMockPayments } from "@/server/payments";
import { safeReturnPath } from "@/lib/form";
import type { Cart } from "@/server/services/cart";

/** Sitenin dışarıdan görünen adresi, sonunda / olmadan. */
export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function appOrigin(): string {
  return new URL(appUrl()).origin;
}

/**
 * Route handler'lar için CSRF denetimi: Origin başlığı sitenin adresiyle aynı olmalı.
 * Geliştirmede siteye telefondan yerel ağ adresiyle de girilebilsin diye isteğin kendi
 * Host'u da kabul edilir (Server Action'ların yaptığı denetimle aynı); canlıda yalnızca APP_URL.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin === appOrigin()) return true;
  if (process.env.NODE_ENV === "production") return false;
  const host = request.headers.get("host");
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Test ödemesi kullanılabilir mi: yalnızca sağlayıcı "mock" iken; canlıda ayrıca yalnızca iki
 * adımlı doğrulamayı geçmiş yöneticiye (gerçek müşteri sahte ödemeyle sipariş onaylatamasın).
 */
export async function mockPaymentsAllowed(): Promise<boolean> {
  if (!isMockPayments()) return false;
  if (process.env.NODE_ENV !== "production") return true;
  const session = await getSession();
  return session !== null && session.user.role === "admin" && session.secondFactor;
}

// Tarayıcılar URL'deki sekme/satır sonunu siler: "/\t/site.com" → "//site.com" (açık yönlendirme)
const UNSAFE_URL_CHARS = /[\u0000-\u001F\u007F\\\s]/;

/**
 * Sağlayıcının döndüğü ödeme adresini süzer: site içi göreli yol ya da https adresi.
 * Başka her şeyde siparişin sayfasına dönülür.
 */
export function paymentRedirectTarget(url: string, fallback: string): string {
  if (typeof url !== "string" || url.length > 2000 || UNSAFE_URL_CHARS.test(url)) return fallback;
  if (url.startsWith("/")) return safeReturnPath(url, fallback);
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

/** Ödeme token'ı biçimi (randomToken: base64url). */
export const PAYMENT_TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * Ödeme sayfasında gösterilen sepetin parmak izi. Form bunu gizli alanla geri yollar; sipariş
 * oluşturulmadan önce sepet yeniden okunur ve iz tutmazsa (bu arada fiyat, adet ya da kargo
 * değiştiyse) müşteri onaylamadığı bir tutarla siparişe geçmez. Tutar formdan alınmaz; iz
 * yalnızca karşılaştırma içindir.
 */
export function cartSignature(cart: Pick<Cart, "lines" | "shippingFee" | "total">): string {
  const payload = [
    ...cart.lines.map((l) => `${l.id}:${l.variantId}:${l.quantity}:${l.unitPrice}:${l.problem ?? ""}`),
    `kargo:${cart.shippingFee}`,
    `toplam:${cart.total}`,
  ].join("|");
  return createHash("sha256").update(payload).digest("base64url").slice(0, 32);
}
