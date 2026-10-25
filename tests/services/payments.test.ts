import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { completePayment, PaymentError, startPayment } from "@/server/services/payments";
import { releaseExpiredOrders } from "@/server/services/orders";
import { makeProduct, resetDb } from "../helpers/db";
import { orderFor } from "../helpers/order";

beforeEach(resetDb);

const ctx = { appUrl: "http://localhost:3000", ip: "1.2.3.4" };

async function paidSetup(stock = 2) {
  const { variants } = await makeProduct({ price: 100000, sizes: [{ size: "40", stock }] });
  const order = await orderFor({ guestToken: "g" }, variants[0]!.id);
  const { redirectUrl } = await startPayment(order.id, ctx);
  const token = redirectUrl.split("/").at(-1)!;
  return { order, token, variantId: variants[0]!.id };
}

const orderRow = async (id: string) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0]!;

test("başarılı ödeme siparişi hazırlanıyor durumuna alır; ikinci bildirim etkisizdir", async () => {
  const { order, token } = await paidSetup();
  expect((await completePayment({ token, success: true, amount: order.total })).status).toBe("paid");
  expect((await completePayment({ token, success: true, amount: order.total })).status).toBe("already_processed");
  const row = await orderRow(order.id);
  expect(row.status).toBe("preparing");
  expect(row.paidAt).not.toBeNull();
  expect(await db.select().from(schema.payments)).toHaveLength(1);
});

test("tutar uyuşmazsa sipariş onaylanmaz", async () => {
  const { order, token } = await paidSetup();
  expect((await completePayment({ token, success: true, amount: 1 })).status).toBe("amount_mismatch");
  expect((await orderRow(order.id)).status).toBe("awaiting_payment");
  const [log] = await db.select().from(schema.auditLog);
  expect(log!.action).toBe("payment.amount_mismatch");
});

test("başarısız ödeme siparişi bekletir; yeniden denenebilir", async () => {
  const { order, token } = await paidSetup();
  expect((await completePayment({ token, success: false, amount: order.total })).status).toBe("failed");
  expect((await orderRow(order.id)).status).toBe("awaiting_payment");
  await expect(startPayment(order.id, ctx)).resolves.toBeTruthy();
});

test("bilinmeyen token reddedilir", async () => {
  expect((await completePayment({ token: "uydurma", success: true, amount: 1 })).status).toBe("not_found");
});

test("süresi geçmiş siparişe ödeme başlatılamaz", async () => {
  const { variants } = await makeProduct();
  const order = await orderFor({ guestToken: "g" }, variants[0]!.id);
  await db.update(schema.orders).set({ paymentExpiresAt: new Date(Date.now() - 1) });
  await expect(startPayment(order.id, ctx)).rejects.toBeInstanceOf(PaymentError);
});

test("süre dolduktan sonra gelen onay, stok varsa siparişi geri alır", async () => {
  const { order, token, variantId } = await paidSetup(1);
  await db.update(schema.orders).set({ paymentExpiresAt: new Date(Date.now() - 1) });
  await releaseExpiredOrders();
  expect((await completePayment({ token, success: true, amount: order.total })).status).toBe("paid");
  expect((await orderRow(order.id)).status).toBe("preparing");
  const [v] = await db.select().from(schema.variants).where(eq(schema.variants.id, variantId));
  expect(v!.stock).toBe(0);
});

test("süre dolduktan sonra gelen onay, stok satılmışsa iade gerekli olarak işaretlenir", async () => {
  const { order, token, variantId } = await paidSetup(1);
  await db.update(schema.orders).set({ paymentExpiresAt: new Date(Date.now() - 1) });
  await releaseExpiredOrders();
  await db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.id, variantId));
  expect((await completePayment({ token, success: true, amount: order.total })).status).toBe("needs_refund");
  expect((await orderRow(order.id)).status).toBe("cancelled");
  const logs = await db.select().from(schema.auditLog);
  expect(logs.map((l) => l.action)).toContain("payment.needs_refund");
});
