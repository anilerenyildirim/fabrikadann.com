import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { completePayment, startPayment } from "@/server/services/payments";
import { db, schema } from "@/server/db";
import { makeProduct, resetDb } from "../helpers/db";
import { orderFor } from "../helpers/order";

const sendMail = vi.hoisted(() => vi.fn(async (_mail: { to: string; subject: string; text: string }) => {}));
vi.mock("@/server/mail", () => ({ sendMail }));

beforeEach(async () => {
  await resetDb();
  sendMail.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

async function pending() {
  const { variants } = await makeProduct({ price: 100000, sizes: [{ size: "40", stock: 2 }] });
  const order = await orderFor({ guestToken: "g" }, variants[0]!.id);
  const { redirectUrl } = await startPayment(order.id, { appUrl: "http://localhost:3000", ip: "1.2.3.4" });
  return { order, token: redirectUrl.split("/").at(-1)! };
}

test("ödemesi alınan sipariş mağazaya (varsayılan kurumsal@) bildirilir; ikinci bildirim tekrar göndermez", async () => {
  const { order, token } = await pending();
  await completePayment({ token, success: true, amount: order.total });
  const store = sendMail.mock.calls.map((c) => c[0]).filter((m) => m.to === "kurumsal@fabrikadann.com");
  expect(store).toHaveLength(1);
  expect(store[0]!.subject).toContain(order.number);
  expect(store[0]!.text).toContain("Ayşe Yılmaz");
  expect(store[0]!.text).toContain(`/yonetim/siparisler/${order.id}`);
  // Müşteriye de onay gider
  expect(sendMail.mock.calls.some((c) => c[0].to === "ayse@ornek.com")).toBe(true);

  sendMail.mockClear();
  await completePayment({ token, success: true, amount: order.total });
  expect(sendMail).not.toHaveBeenCalled();
});

test("başarısız ödemede bildirim yok; tutar uyuşmazsa mağazaya iade uyarısı gider", async () => {
  const a = await pending();
  await completePayment({ token: a.token, success: false, amount: a.order.total });
  expect(sendMail).not.toHaveBeenCalled();

  await resetDb();
  const b = await pending();
  await completePayment({ token: b.token, success: true, amount: 1 });
  expect(sendMail).toHaveBeenCalledTimes(1);
  expect(sendMail.mock.calls[0]![0].to).toBe("kurumsal@fabrikadann.com");
  expect(sendMail.mock.calls[0]![0].subject).toMatch(/^İADE GEREKLİ/);
});

test("ORDER_NOTIFY_EMAIL adresi değiştirir; boşsa mağaza bildirimi gönderilmez", async () => {
  vi.stubEnv("ORDER_NOTIFY_EMAIL", "baska@fabrikadann.com");
  const a = await pending();
  await completePayment({ token: a.token, success: true, amount: a.order.total });
  expect(sendMail.mock.calls.map((c) => c[0].to)).toContain("baska@fabrikadann.com");

  await resetDb();
  sendMail.mockClear();
  vi.stubEnv("ORDER_NOTIFY_EMAIL", "");
  const b = await pending();
  await completePayment({ token: b.token, success: true, amount: b.order.total });
  expect(sendMail.mock.calls.map((c) => c[0].to)).toEqual(["ayse@ornek.com"]);
});

const notes = () => db.select().from(schema.notifications);

test("ödenen sipariş bildirim kutusuna order_new yazar; müşteri bilgisi yok; ikinci işlemede ikinci kayıt yok", async () => {
  const { order, token } = await pending();
  await completePayment({ token, success: true, amount: order.total });
  await completePayment({ token, success: true, amount: order.total });
  const rows = (await notes()).filter((n) => n.kind === "order_new");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ source: "site", dedupeKey: `site:order:${order.number}`, title: `Yeni sipariş ${order.number}`, url: `/yonetim/siparisler/${order.id}` });
  expect(rows[0]!.body).toMatch(/^1 ürün · /);
  expect(rows[0]!.body).not.toContain("Ayşe");
});

test("iade gereken ödeme refund_needed yazar", async () => {
  const { order, token } = await pending();
  await completePayment({ token, success: true, amount: 1 });
  const rows = (await notes()).filter((n) => n.kind === "refund_needed");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ dedupeKey: `site:refund:${order.number}`, title: `İade gerekli: ${order.number}` });
});

test("sipariş son stoğu bitirince stok tükendi bildirimi", async () => {
  const { variants } = await makeProduct({ name: "Bot", sizes: [{ size: "40", stock: 1 }] });
  const order = await orderFor({ guestToken: "g2" }, variants[0]!.id);
  const rows = (await notes()).filter((n) => n.kind === "stock_out");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ source: "site", dedupeKey: `stock:${order.number}`, body: "Bot Siyah 40: 0" });
});
