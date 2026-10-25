import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { addToCart, getCart } from "@/server/services/cart";
import {
  createOrder,
  getOrderForGuest,
  getOrderForUser,
  OrderError,
  releaseExpiredOrders,
  transitionOrder,
} from "@/server/services/orders";
import { makeProduct, makeUser, resetDb } from "../helpers/db";
import { address, orderFor } from "../helpers/order";

beforeEach(resetDb);

const stockOf = async (id: string) =>
  (await db.select().from(schema.variants).where(eq(schema.variants.id, id)))[0]!.stock;

test("sipariş stoğu düşer, kalemleri o anki fiyatla kopyalar ve sepeti boşaltır", async () => {
  const { variants } = await makeProduct({ price: 150000, sizes: [{ size: "40", stock: 3 }] });
  const owner = { guestToken: "g1" };
  const order = await orderFor(owner, variants[0]!.id, 2);
  expect(order.number).toMatch(/^FD[A-Z2-9]{8}$/);
  expect(order.guestAccessToken).toBeTruthy();
  expect(await stockOf(variants[0]!.id)).toBe(1);
  expect((await getCart(owner)).lines).toHaveLength(0);
  const saved = (await getOrderForGuest(order.number, order.guestAccessToken!))!;
  expect(saved.items[0]).toMatchObject({ unitPrice: 150000, quantity: 2, size: "40" });
  expect(saved.total).toBe(300000 + saved.shippingFee);
  const moves = await db.select().from(schema.stockMovements);
  expect(moves).toMatchObject([{ delta: -2, reason: "order", reference: order.number }]);
});

test("son çifti iki kişi aynı anda alırsa yalnızca biri başarılı olur", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 1 }] });
  const a = { guestToken: "a" };
  const b = { guestToken: "b" };
  await addToCart(a, variants[0]!.id);
  await addToCart(b, variants[0]!.id);
  const results = await Promise.allSettled([
    createOrder(a, { email: "a@x.com", userId: null, address, ip: "1" }),
    createOrder(b, { email: "b@x.com", userId: null, address, ip: "2" }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(OrderError);
  expect(await stockOf(variants[0]!.id)).toBe(0);
  expect(await db.select().from(schema.orders)).toHaveLength(1);
});

test("sepette sorunlu kalem varken sipariş oluşmaz", async () => {
  const { product, variants } = await makeProduct();
  const owner = { guestToken: "g" };
  await addToCart(owner, variants[0]!.id);
  await db.update(schema.products).set({ status: "archived" }).where(eq(schema.products.id, product.id));
  await expect(createOrder(owner, { email: "a@x.com", userId: null, address, ip: "1" })).rejects.toMatchObject({
    code: "cart_problems",
  });
  await expect(
    createOrder({ guestToken: "bos" }, { email: "a@x.com", userId: null, address, ip: "1" }),
  ).rejects.toMatchObject({ code: "empty_cart" });
});

test("ödeme süresi dolan sipariş iptal edilir ve stok geri gelir", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 2 }] });
  const order = await orderFor({ guestToken: "g" }, variants[0]!.id, 2);
  expect(await releaseExpiredOrders()).toBe(0);
  await db.update(schema.orders).set({ paymentExpiresAt: new Date(Date.now() - 1000) });
  expect(await releaseExpiredOrders()).toBe(1);
  expect(await releaseExpiredOrders()).toBe(0);
  expect(await stockOf(variants[0]!.id)).toBe(2);
  const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id));
  expect(row!.status).toBe("cancelled");
});

test("izinsiz durum geçişi reddedilir, kargoya verirken takip no zorunlu", async () => {
  const admin = await makeUser({ role: "admin" });
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 2 }] });
  const order = await orderFor({ guestToken: "g" }, variants[0]!.id);
  await expect(transitionOrder(order.id, "shipped", admin.id)).rejects.toMatchObject({ code: "invalid_transition" });
  await expect(transitionOrder(order.id, "preparing", admin.id)).rejects.toMatchObject({ code: "invalid_transition" });
  await db.update(schema.orders).set({ status: "preparing" }).where(eq(schema.orders.id, order.id));
  await expect(transitionOrder(order.id, "shipped", admin.id)).rejects.toMatchObject({ code: "missing_tracking" });
  await transitionOrder(order.id, "shipped", admin.id, { carrier: "Yurtiçi", trackingNumber: "123" });
  await expect(transitionOrder(order.id, "cancelled", admin.id)).rejects.toMatchObject({ code: "invalid_transition" });
});

test("iptal ve iade stoğu geri koyar (iade isteğe bağlı)", async () => {
  const admin = await makeUser({ role: "admin" });
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 3 }] });
  const a = await orderFor({ guestToken: "a" }, variants[0]!.id);
  const b = await orderFor({ guestToken: "b" }, variants[0]!.id);
  expect(await stockOf(variants[0]!.id)).toBe(1);
  await transitionOrder(a.id, "cancelled", admin.id);
  expect(await stockOf(variants[0]!.id)).toBe(2);
  await db.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.id, b.id));
  await transitionOrder(b.id, "refunded", admin.id, { restock: false });
  expect(await stockOf(variants[0]!.id)).toBe(2);
});

test("sipariş yalnızca sahibine görünür", async () => {
  const owner = await makeUser();
  const other = await makeUser();
  const { variants } = await makeProduct();
  const order = await orderFor({ userId: owner.id }, variants[0]!.id, 1, owner.id);
  expect(order.guestAccessToken).toBeNull();
  expect(await getOrderForUser(owner.id, order.number)).not.toBeNull();
  expect(await getOrderForUser(other.id, order.number)).toBeNull();
  expect(await getOrderForGuest(order.number, "tahmin")).toBeNull();
});
