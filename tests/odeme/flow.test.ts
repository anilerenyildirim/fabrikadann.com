import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { addGuestOrder, parseGuestOrders, serializeGuestOrders } from "@/server/guest-orders";
import { addToCart, getCart } from "@/server/services/cart";
import { createOrder, getOrderForGuest, getOrderForUser } from "@/server/services/orders";
import { completePayment, getPendingPayment, startPayment } from "@/server/services/payments";
import { makeProduct, makeUser, resetDb } from "../helpers/db";
import { address } from "../helpers/order";

beforeEach(resetDb);

const ctx = { appUrl: "http://localhost:3000", ip: "1.2.3.4" };
const tokenOf = (redirectUrl: string) => redirectUrl.split("/").at(-1)!;
const stockOf = async (variantId: string) =>
  (await db.select().from(schema.variants).where(eq(schema.variants.id, variantId)))[0]!.stock;

test("misafir: sepet → sipariş → ödeme → onay; sipariş yalnızca çerezdeki token'la görülür", async () => {
  const { variants } = await makeProduct({ price: 120000, sizes: [{ size: "40", stock: 3 }] });
  const variantId = variants[0]!.id;
  const owner = { guestToken: "misafir-sepeti" };

  expect((await addToCart(owner, variantId, 2)).ok).toBe(true);
  const cart = await getCart(owner);
  expect(cart.hasProblems).toBe(false);

  const order = await createOrder(owner, { email: "misafir@ornek.com", userId: null, address, ip: ctx.ip });
  expect(order.total).toBe(cart.total);
  expect(order.guestAccessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // Stok sipariş anında ayrılır, sepet boşalır
  expect(await stockOf(variantId)).toBe(1);
  expect((await getCart(owner)).lines).toHaveLength(0);

  // Çerez gidiş-dönüşü: ödeme sayfasının yazdığı değer sipariş sayfasında aynen okunur
  const cookie = serializeGuestOrders(addGuestOrder([], { number: order.number, token: order.guestAccessToken! }));
  const [ref] = parseGuestOrders(cookie);
  expect(ref).toEqual({ number: order.number, token: order.guestAccessToken });

  const { redirectUrl } = await startPayment(order.id, ctx);
  expect(redirectUrl).toMatch(/^\/odeme\/test\/[A-Za-z0-9_-]{43}$/);
  const token = tokenOf(redirectUrl);
  const pending = await getPendingPayment(token);
  expect(pending).toMatchObject({ amount: order.total, orderNumber: order.number, status: "pending" });

  const result = await completePayment({ token, success: true, amount: pending!.amount, providerRef: "test-1" });
  expect(result).toMatchObject({ status: "paid", orderNumber: order.number });

  const viewed = await getOrderForGuest(ref!.number, ref!.token);
  expect(viewed?.status).toBe("preparing");
  expect(viewed?.paidAt).not.toBeNull();
  expect(viewed?.items).toHaveLength(1);
  expect(viewed?.items[0]).toMatchObject({ unitPrice: 120000, quantity: 2, size: "40" });
  expect(viewed?.shippingAddress).toEqual(address);

  // Ödeme bir kez işlenir; test sayfası artık açılmaz
  expect(await getPendingPayment(token)).toBeNull();
  // Token'sız ya da yanlış token'la sipariş görülemez (IDOR yok)
  expect(await getOrderForGuest(order.number, "uydurma")).toBeNull();
  expect(await getOrderForGuest(order.number, "")).toBeNull();
});

test("başarısız ödemeden sonra yeni denemeyle tamamlanır; eski token geçersizdir", async () => {
  const { variants } = await makeProduct({ price: 50000 });
  const owner = { guestToken: "misafir-2" };
  await addToCart(owner, variants[0]!.id, 1);
  const order = await createOrder(owner, { email: "m@ornek.com", userId: null, address, ip: ctx.ip });

  const first = tokenOf((await startPayment(order.id, ctx)).redirectUrl);
  expect((await completePayment({ token: first, success: false, amount: order.total })).status).toBe("failed");
  expect((await getOrderForGuest(order.number, order.guestAccessToken!))?.status).toBe("awaiting_payment");
  expect(await getPendingPayment(first)).toBeNull();

  const second = tokenOf((await startPayment(order.id, ctx)).redirectUrl);
  expect(second).not.toBe(first);
  expect((await completePayment({ token: second, success: true, amount: order.total })).status).toBe("paid");
  expect((await getOrderForGuest(order.number, order.guestAccessToken!))?.status).toBe("preparing");
});

test("üye: sipariş kullanıcıya bağlanır, misafir token'ı üretilmez; başka üye göremez", async () => {
  const [ayse, mehmet] = [await makeUser(), await makeUser()];
  const { variants } = await makeProduct({ price: 80000 });
  const owner = { userId: ayse.id };
  await addToCart(owner, variants[0]!.id, 1);
  const order = await createOrder(owner, { email: ayse.email, userId: ayse.id, address, ip: ctx.ip });
  expect(order.guestAccessToken).toBeNull();

  const token = tokenOf((await startPayment(order.id, ctx)).redirectUrl);
  await completePayment({ token, success: true, amount: order.total });

  expect((await getOrderForUser(ayse.id, order.number))?.status).toBe("preparing");
  expect(await getOrderForUser(mehmet.id, order.number)).toBeNull();
});

test("sepete eklendikten sonra fiyat değişirse ödeme güncel fiyattan alınır", async () => {
  const { product, variants } = await makeProduct({ price: 100000 });
  const owner = { guestToken: "misafir-3" };
  await addToCart(owner, variants[0]!.id, 1);
  await db.update(schema.products).set({ price: 90000 }).where(eq(schema.products.id, product.id));

  const order = await createOrder(owner, { email: "m@ornek.com", userId: null, address, ip: ctx.ip });
  const token = tokenOf((await startPayment(order.id, ctx)).redirectUrl);
  const pending = await getPendingPayment(token);
  // 900 TL ücretsiz kargo eşiğinin altında: kargo eklenir
  expect(order.total).toBe(90000 + 9990);
  expect(pending?.amount).toBe(order.total);
});
