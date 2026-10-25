import { beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { makeProduct, makeUser, resetDb } from "../helpers/db";
import { orderFor } from "../helpers/order";

// Sipariş sayfasının erişim kapısı: oturum ve çerezler dışarıdan verilir
const ctx = vi.hoisted(() => ({
  user: null as null | { id: string },
  cookies: new Map<string, string>(),
}));
vi.mock("@/server/auth/current", () => ({ getCurrentUser: async () => ctx.user }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (ctx.cookies.has(name) ? { name, value: ctx.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void ctx.cookies.set(name, value),
  }),
}));

const { getAccessibleOrder, listOpenAccessibleOrders, rememberGuestOrder, GUEST_ORDERS_COOKIE } = await import(
  "@/server/guest-orders"
);

beforeEach(async () => {
  await resetDb();
  ctx.user = null;
  ctx.cookies.clear();
});

test("misafir siparişi yalnızca çerezinde token'ı olan tarayıcı görür", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }] });
  const order = await orderFor({ guestToken: "misafir-a" }, variants[0]!.id);

  // Çerez yok: sipariş yok sayılır (numara bilinse bile)
  expect(await getAccessibleOrder(order.number)).toBeNull();

  await rememberGuestOrder(order.number, order.guestAccessToken!);
  expect((await getAccessibleOrder(order.number))?.id).toBe(order.id);

  // Çerezdeki token başka siparişin numarasıyla eşleştirilemez
  const other = await orderFor({ guestToken: "misafir-b" }, variants[0]!.id);
  ctx.cookies.set(GUEST_ORDERS_COOKIE, `${other.number}.${order.guestAccessToken}`);
  expect(await getAccessibleOrder(other.number)).toBeNull();

  // Biçimi tutmayan numara sorgulanmaz
  expect(await getAccessibleOrder("FD' OR 1=1")).toBeNull();
});

test("üye yalnızca kendi siparişini görür", async () => {
  const [ayse, mehmet] = [await makeUser(), await makeUser()];
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }] });
  const order = await orderFor({ userId: ayse.id }, variants[0]!.id, 1, ayse.id);

  ctx.user = { id: mehmet.id };
  expect(await getAccessibleOrder(order.number)).toBeNull();
  ctx.user = { id: ayse.id };
  expect((await getAccessibleOrder(order.number))?.id).toBe(order.id);
});

test("açık sipariş listesi yalnızca erişilebilen ve ödemesi süren siparişleri içerir", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }] });
  const mine = await orderFor({ guestToken: "misafir-a" }, variants[0]!.id);
  const expired = await orderFor({ guestToken: "misafir-c" }, variants[0]!.id);
  await db
    .update(schema.orders)
    .set({ paymentExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(schema.orders.id, expired.id));

  await rememberGuestOrder(mine.number, mine.guestAccessToken!);
  await rememberGuestOrder(expired.number, expired.guestAccessToken!);
  expect(await listOpenAccessibleOrders()).toEqual([mine.number]);
});
