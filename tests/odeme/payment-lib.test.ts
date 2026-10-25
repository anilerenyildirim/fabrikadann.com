import { describe, expect, test } from "vitest";
import { cartSignature, isSameOriginRequest, paymentRedirectTarget } from "@/app/(magaza)/odeme/_lib/payment";
import { checkoutBlocker, itemsOverLimit } from "@/components/cart/CartSummary";
import type { Cart, CartLine } from "@/server/services/cart";
import { MAX_ITEMS_PER_ORDER } from "@/server/services/orders";

const fallback = "/siparis/FDABCDEFGH";

describe("ödeme yönlendirme hedefi", () => {
  test("site içi yol ve https adresi geçer", () => {
    expect(paymentRedirectTarget("/odeme/test/abc_DEF-123", fallback)).toBe("/odeme/test/abc_DEF-123");
    expect(paymentRedirectTarget("https://sandbox-cpp.iyzipay.com/?token=x", fallback)).toBe(
      "https://sandbox-cpp.iyzipay.com/?token=x",
    );
  });

  test("açık yönlendirme ve tehlikeli adresler siparişe döner", () => {
    for (const bad of [
      "//kotu.example",
      "/\\kotu.example",
      "/\t/kotu.example",
      "/\n/kotu.example",
      "http://kotu.example",
      "javascript:alert(1)",
      "https://kullanici:parola@kotu.example",
      "data:text/html,x",
      "",
      "kotu.example",
      `/${"a".repeat(3000)}`,
    ]) {
      expect(paymentRedirectTarget(bad, fallback)).toBe(fallback);
    }
  });
});

describe("aynı site denetimi (CSRF)", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/odeme/mock", { method: "POST", headers });
  const appOrigin = new URL(process.env.APP_URL || "http://localhost:3000").origin;

  test("APP_URL ile aynı Origin kabul, Origin'siz ya da yabancı Origin red", () => {
    expect(isSameOriginRequest(req({ origin: appOrigin }))).toBe(true);
    expect(isSameOriginRequest(req({}))).toBe(false);
    expect(isSameOriginRequest(req({ origin: "https://kotu.example" }))).toBe(false);
    expect(isSameOriginRequest(req({ origin: "null" }))).toBe(false);
  });
});

const line = (over: Partial<CartLine> = {}): CartLine => ({
  id: "11111111-1111-4111-8111-111111111111",
  variantId: "22222222-2222-4222-8222-222222222222",
  productId: "p",
  productName: "Ürün",
  productSlug: "urun",
  colorName: "Siyah",
  size: "40",
  sku: "SKU",
  unitPrice: 100000,
  quantity: 1,
  lineTotal: 100000,
  image: null,
  problem: null,
  maxQuantity: 5,
  ...over,
});

const cartOf = (lines: CartLine[], shippingFee = 0): Cart => {
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  return {
    id: "c",
    lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal,
    shippingFee,
    total: subtotal + shippingFee,
    freeShippingThreshold: 90000,
    hasProblems: lines.some((l) => l.problem !== null),
  };
};

describe("sepet parmak izi", () => {
  test("aynı sepet aynı iz; fiyat, adet, kargo ya da sorun değişirse iz değişir", () => {
    const base = cartSignature(cartOf([line()]));
    expect(cartSignature(cartOf([line()]))).toBe(base);
    expect(cartSignature(cartOf([line({ unitPrice: 90000, lineTotal: 90000 })]))).not.toBe(base);
    expect(cartSignature(cartOf([line({ quantity: 2, lineTotal: 200000 })]))).not.toBe(base);
    expect(cartSignature(cartOf([line()], 9990))).not.toBe(base);
    expect(cartSignature(cartOf([line({ problem: "out_of_stock" })]))).not.toBe(base);
    expect(base).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe("ödemeye geçiş engeli", () => {
  test("boş, sorunlu ve üst sınırı aşan sepet ödemeye geçemez", () => {
    expect(checkoutBlocker(cartOf([]))).toMatch(/boş/);
    expect(checkoutBlocker(cartOf([line({ problem: "unavailable" })]))).toMatch(/işaretli/);
    expect(checkoutBlocker(cartOf([line()]))).toBeNull();

    const many = Array.from({ length: 3 }, (_, i) =>
      line({ id: `${i}`, variantId: `v${i}`, quantity: 4, lineTotal: 400000 }),
    );
    const cart = cartOf(many);
    expect(itemsOverLimit(cart)).toBe(12 - MAX_ITEMS_PER_ORDER);
    expect(checkoutBlocker(cart)).toContain(`${12 - MAX_ITEMS_PER_ORDER} çift çıkarın`);
  });
});
