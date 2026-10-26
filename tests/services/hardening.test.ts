import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { addToCart } from "@/server/services/cart";
import { createOrder, releaseExpiredOrders, transitionOrder } from "@/server/services/orders";
import { completePayment, startPayment } from "@/server/services/payments";
import { reservedByVariant, setPhysicalCount, setStock, StaleStockError } from "@/server/services/stock";
import { makeProduct, makeUser, resetDb } from "../helpers/db";
import { address, orderFor } from "../helpers/order";

beforeEach(resetDb);

const ctx = { appUrl: "http://localhost:3000", ip: "1.2.3.4" };
const stockOf = async (id: string) =>
  (await db.select().from(schema.variants).where(eq(schema.variants.id, id)))[0]!.stock;

test("bir siparişte en fazla 10 çift", async () => {
  const { variants } = await makeProduct({
    sizes: [{ size: "40", stock: 9 }, { size: "41", stock: 9 }, { size: "42", stock: 9 }],
  });
  const owner = { guestToken: "g" };
  for (const v of variants) await addToCart(owner, v.id, 4);
  await expect(createOrder(owner, { email: "a@x.com", userId: null, address, ip: "9.9.9.9" })).rejects.toMatchObject({
    code: "too_many_items",
  });
  expect(await stockOf(variants[0]!.id)).toBe(9);
});

test("aynı e-postayla en fazla 2, aynı IP'den en fazla 5 ödenmemiş sipariş", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 20 }] });
  const mk = (n: number, ip: string, email: string) =>
    addToCart({ guestToken: `g${n}` }, variants[0]!.id).then(() =>
      createOrder({ guestToken: `g${n}` }, { email, userId: null, address, ip }),
    );
  await mk(1, "6.6.6.6", "a@x.com");
  await mk(2, "6.6.6.6", "a@x.com");
  await expect(mk(3, "6.6.6.6", "a@x.com")).rejects.toMatchObject({ code: "too_many_open_orders" });
  // Misafir e-postası doğrulanmadığı için başka bir yerden aynı e-postayla verilen sipariş engellenmez
  await expect(mk(4, "8.8.8.8", "a@x.com")).resolves.toBeTruthy();
  // Mobil operatörde aynı IP'yi paylaşan farklı müşteriler: 5'e kadar
  for (let i = 0; i < 5; i++) await mk(10 + i, "5.5.5.5", `kisi${i}@x.com`);
  await expect(mk(20, "5.5.5.5", "yeni@x.com")).rejects.toMatchObject({ code: "too_many_open_orders" });
});

test("yöneticinin iptal ettiği sipariş geç gelen ödemeyle canlanmaz, iade gerekli olur", async () => {
  const admin = await makeUser({ role: "admin" });
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 3 }] });
  const order = await orderFor({ guestToken: "g" }, variants[0]!.id);
  const token = (await startPayment(order.id, ctx)).redirectUrl.split("/").at(-1)!;
  await transitionOrder(order.id, "cancelled", admin.id);
  expect((await completePayment({ token, success: true, amount: order.total })).status).toBe("needs_refund");
  const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id));
  expect(row!.status).toBe("cancelled");
  expect(row!.cancelReason).toBe("admin");
  expect(await stockOf(variants[0]!.id)).toBe(3);
});

test("süre dolmasıyla iptal edilen sipariş ödemeyle canlanır", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 3 }] });
  const order = await orderFor({ guestToken: "g" }, variants[0]!.id);
  const token = (await startPayment(order.id, ctx)).redirectUrl.split("/").at(-1)!;
  await db.update(schema.orders).set({ paymentExpiresAt: new Date(Date.now() - 1) });
  await releaseExpiredOrders();
  expect((await completePayment({ token, success: true, amount: order.total })).status).toBe("paid");
});

test("ödenmiş sipariş iptal edilince iade kaydı düşer; ekrandaki durum eskiyse işlem reddedilir", async () => {
  const admin = await makeUser({ role: "admin" });
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 3 }] });
  const order = await orderFor({ guestToken: "g" }, variants[0]!.id);
  const token = (await startPayment(order.id, ctx)).redirectUrl.split("/").at(-1)!;
  await completePayment({ token, success: true, amount: order.total });
  await expect(
    transitionOrder(order.id, "cancelled", admin.id, { expectedFrom: "awaiting_payment" }),
  ).rejects.toMatchObject({ code: "invalid_transition" });
  await transitionOrder(order.id, "cancelled", admin.id, { expectedFrom: "preparing" });
  const logs = await db.select().from(schema.auditLog);
  expect(logs.map((l) => l.action)).toContain("payment.needs_refund");
});

test("fiziksel sayım bekleyen siparişlerdeki adetleri düşer; eski ekrandan stok yazılamaz", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 10 }] });
  const v = variants[0]!.id;
  await orderFor({ guestToken: "g" }, v, 2);
  expect(await stockOf(v)).toBe(8);
  expect((await reservedByVariant(db, [v])).get(v)).toBe(2);
  const result = await db.transaction((tx) => setPhysicalCount(tx, v, 10, { reason: "manual" }));
  expect(result).toEqual({ available: 8, reserved: 2, shortfall: 0 });
  expect(await stockOf(v)).toBe(8);
  await expect(db.transaction((tx) => setStock(tx, v, 5, { reason: "manual", expected: 10 }))).rejects.toBeInstanceOf(
    StaleStockError,
  );
});

test("bir IP'den ödenmemiş siparişler toplam 10 çifti geçemez; başka IP'deki müşteri etkilenmez", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 30 }] });
  const v = variants[0]!.id;
  const mk = (n: number, qty: number, ip: string) =>
    addToCart({ guestToken: `h${n}` }, v, qty).then(() =>
      createOrder({ guestToken: `h${n}` }, { email: `h${n}@x.com`, userId: null, address, ip }),
    );
  await mk(1, 5, "10.0.0.1");
  await mk(2, 5, "10.0.0.1");
  await expect(mk(3, 1, "10.0.0.1")).rejects.toMatchObject({ code: "too_many_open_orders" });
  // Gerçek müşteri, başkasının ödenmemiş ayırması yüzünden reddedilmez
  await expect(mk(4, 5, "10.0.0.2")).resolves.toBeTruthy();
  const [row] = await db.select().from(schema.variants).where(eq(schema.variants.id, v));
  expect(row!.stock).toBe(15);
});
