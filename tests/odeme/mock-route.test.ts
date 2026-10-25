import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { startPayment } from "@/server/services/payments";
import { makeProduct, resetDb } from "../helpers/db";
import { orderFor } from "../helpers/order";

// Canlı ortam kuralını denemek için oturum dışarıdan verilir
const session = vi.hoisted(() => ({ current: null as null | { user: { role: string }; secondFactor: boolean } }));
vi.mock("@/server/auth/current", () => ({ getSession: async () => session.current }));

const { GET, POST } = await import("@/app/api/odeme/mock/route");

const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const origin = new URL(appUrl).origin;

function post(fields: Record<string, string>, headers: Record<string, string> = { origin }) {
  return POST(
    new Request(`${appUrl}/api/odeme/mock`, {
      method: "POST",
      body: new URLSearchParams(fields),
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    }),
  );
}

async function pendingOrder() {
  const { variants } = await makeProduct({ price: 100000 });
  const order = await orderFor({ guestToken: "g" }, variants[0]!.id);
  const { redirectUrl } = await startPayment(order.id, { appUrl, ip: "1.2.3.4" });
  return { order, token: redirectUrl.split("/").at(-1)! };
}

const statusOf = async (id: string) =>
  (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0]!.status;

const env = { ...process.env };
beforeEach(resetDb);
afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = env.NODE_ENV;
  process.env.PAYMENT_PROVIDER = env.PAYMENT_PROVIDER;
  if (env.PAYMENT_PROVIDER === undefined) delete process.env.PAYMENT_PROVIDER;
  session.current = null;
});

test("GET kabul edilmez", () => {
  expect(GET().status).toBe(405);
});

test("başka sitenin ya da Origin'siz isteği reddedilir (CSRF)", async () => {
  const { order, token } = await pendingOrder();
  expect((await post({ token, sonuc: "basarili" }, { origin: "https://kotu.example" })).status).toBe(403);
  expect((await post({ token, sonuc: "basarili" }, {})).status).toBe(403);
  expect((await post({ token, sonuc: "basarili" }, { origin: "null" })).status).toBe(403);
  // Host başlığı saldırganın sitesine eşit değilse kendi Origin'ini "aynı site" sayamaz
  expect(
    (await post({ token, sonuc: "basarili" }, { origin: "https://kotu.example", host: "localhost:3000" })).status,
  ).toBe(403);
  expect(await statusOf(order.id)).toBe("awaiting_payment");
});

test("geliştirmede yerel ağ adresinden (Origin = Host) gönderim kabul edilir; canlıda yalnızca APP_URL", async () => {
  const lan = { origin: "http://192.168.1.26:3000", host: "192.168.1.26:3000" };
  const first = await pendingOrder();
  (process.env as Record<string, string>).NODE_ENV = "production";
  session.current = { user: { role: "admin" }, secondFactor: true };
  expect((await post({ token: first.token, sonuc: "basarili" }, lan)).status).toBe(403);
  (process.env as Record<string, string | undefined>).NODE_ENV = env.NODE_ENV;
  const res = await post({ token: first.token, sonuc: "basarili" }, lan);
  expect(res.status).toBe(303);
  expect(await statusOf(first.order.id)).toBe("preparing");
});

test("bozuk girdi 400, bilinmeyen token 404", async () => {
  const { token } = await pendingOrder();
  expect((await post({ token, sonuc: "belki" })).status).toBe(400);
  expect((await post({ token: "x".repeat(101), sonuc: "basarili" })).status).toBe(400);
  expect((await post({ token: "a<b>", sonuc: "basarili" })).status).toBe(400);
  expect((await post({ sonuc: "basarili" })).status).toBe(400);
  expect((await post({ token: "b".repeat(43), sonuc: "basarili" })).status).toBe(404);
});

test("başarılı sonuç siparişi onaylar ve sipariş sayfasına 303 ile döner; ikinci gönderim etkisiz", async () => {
  const { order, token } = await pendingOrder();
  const res = await post({ token, sonuc: "basarili" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe(`/siparis/${order.number}?odeme=basarili`);
  expect(await statusOf(order.id)).toBe("preparing");
  const [payment] = await db.select().from(schema.payments);
  expect(payment).toMatchObject({ status: "succeeded", amount: order.total });
  expect(payment!.providerRef).toMatch(/^test-[0-9a-f]{12}$/);

  expect((await post({ token, sonuc: "basarili" })).status).toBe(404);
});

test("başarısız sonuç siparişi ödeme bekler durumda bırakır", async () => {
  const { order, token } = await pendingOrder();
  const res = await post({ token, sonuc: "basarisiz" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe(`/siparis/${order.number}?odeme=basarisiz`);
  expect(await statusOf(order.id)).toBe("awaiting_payment");
});

test("test ödemesi kapalıysa 404", async () => {
  const { order, token } = await pendingOrder();
  process.env.PAYMENT_PROVIDER = "iyzico";
  expect((await post({ token, sonuc: "basarili" })).status).toBe(404);
  expect(await statusOf(order.id)).toBe("awaiting_payment");
});

test("canlıda yalnızca iki adımlı doğrulamayı geçmiş yönetici kullanabilir", async () => {
  const { order, token } = await pendingOrder();
  (process.env as Record<string, string>).NODE_ENV = "production";

  session.current = null;
  expect((await post({ token, sonuc: "basarili" })).status).toBe(404);
  session.current = { user: { role: "customer" }, secondFactor: true };
  expect((await post({ token, sonuc: "basarili" })).status).toBe(404);
  session.current = { user: { role: "admin" }, secondFactor: false };
  expect((await post({ token, sonuc: "basarili" })).status).toBe(404);
  expect(await statusOf(order.id)).toBe("awaiting_payment");

  session.current = { user: { role: "admin" }, secondFactor: true };
  expect((await post({ token, sonuc: "basarili" })).status).toBe(303);
  expect(await statusOf(order.id)).toBe("preparing");
});
