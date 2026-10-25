import { createHmac } from "node:crypto";
import { expect, test } from "vitest";
import { buildInitializeRequest, fromIyzicoPrice, iyzicoAuthHeader, toIyzicoPrice } from "@/server/payments/iyzico";

const input = {
  token: "odeme-token",
  callbackUrl: "https://fabrikadann.com/api/odeme/iyzico",
  order: {
    id: "o1",
    number: "FDABCDEFGH",
    total: 389790,
    email: "ayse@ornek.com",
    ip: "1.2.3.4",
    address: { fullName: "Ayşe Nur Yılmaz", phone: "05551112233", city: "İstanbul", district: "Kadıköy", line: "Moda Cd. 1" },
    items: [
      { name: "Deri Sneaker", sku: "FD-1", unitPrice: 189900, quantity: 2 },
    ],
  },
};

test("fiyat biçimi", () => {
  expect(toIyzicoPrice(129990)).toBe("1299.90");
  expect(fromIyzicoPrice("1299.9")).toBe(129990);
  expect(fromIyzicoPrice(0.1 + 0.2)).toBe(30);
});

test("IYZWSv2 imzası", () => {
  const header = iyzicoAuthHeader({ apiKey: "anahtar", secretKey: "gizli" }, "123", "/yol", "{}");
  const expectedSig = createHmac("sha256", "gizli").update("123/yol{}").digest("hex");
  expect(Buffer.from(header.replace("IYZWSv2 ", ""), "base64").toString()).toBe(
    `apiKey:anahtar&randomKey:123&signature:${expectedSig}`,
  );
});

test("sepet kalemleri toplamı sipariş tutarına eşit, kargo ayrı kalem", () => {
  const body = buildInitializeRequest(input, 9990);
  const sum = body.basketItems.reduce((s, i) => s + fromIyzicoPrice(i.price), 0);
  expect(sum).toBe(input.order.total);
  expect(body.price).toBe("3897.90");
  expect(body.conversationId).toBe("odeme-token");
  expect(body.basketId).toBe("FDABCDEFGH");
  expect(body.buyer).toMatchObject({ name: "Ayşe Nur", surname: "Yılmaz", gsmNumber: "+905551112233" });
  expect(buildInitializeRequest({ ...input, order: { ...input.order, total: 379800 } }, 0).basketItems).toHaveLength(1);
});
