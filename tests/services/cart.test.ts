import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { addToCart, getCart, mergeGuestCart, removeLine, setQuantity } from "@/server/services/cart";
import { updateSettings } from "@/server/services/settings";
import { makeProduct, makeUser, resetDb } from "../helpers/db";

beforeEach(resetDb);

const guest = { guestToken: "misafir-token-1" };

test("sepete eklenen ürün güncel fiyatla görünür", async () => {
  const { product, variants } = await makeProduct({ price: 100000 });
  expect(await addToCart(guest, variants[0]!.id, 2)).toEqual({ ok: true });
  await db.update(schema.products).set({ price: 80000 }).where(eq(schema.products.id, product.id));
  const cart = await getCart(guest);
  expect(cart.lines[0]!.unitPrice).toBe(80000);
  expect(cart.subtotal).toBe(160000);
});

test("arşivlenen ürün satın alınamaz olarak işaretlenir ve toplama girmez", async () => {
  const { product, variants } = await makeProduct();
  await addToCart(guest, variants[0]!.id);
  await db.update(schema.products).set({ status: "archived" }).where(eq(schema.products.id, product.id));
  const cart = await getCart(guest);
  expect(cart.lines[0]!.problem).toBe("unavailable");
  expect(cart.subtotal).toBe(0);
  expect(cart.hasProblems).toBe(true);
});

test("stoktan fazla ya da satılmayan ürün eklenemez", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 2 }] });
  expect((await addToCart(guest, variants[0]!.id, 3)).ok).toBe(false);
  expect((await addToCart(guest, variants[0]!.id, 2)).ok).toBe(true);
  expect((await addToCart(guest, variants[0]!.id, 1)).ok).toBe(false);
  const { variants: draft } = await makeProduct({ status: "draft" });
  expect((await addToCart(guest, draft[0]!.id)).ok).toBe(false);
  expect((await addToCart(guest, variants[0]!.id, 0)).ok).toBe(false);
  expect((await addToCart(guest, variants[0]!.id, 1.5)).ok).toBe(false);
});

test("başka bir sepetin satırı değiştirilemez ve silinemez", async () => {
  const { variants } = await makeProduct();
  await addToCart(guest, variants[0]!.id);
  const lineId = (await getCart(guest)).lines[0]!.id;
  const other = { guestToken: "baska-misafir" };
  await addToCart(other, variants[0]!.id);
  await setQuantity(other, lineId, 3);
  await removeLine(other, lineId);
  expect((await getCart(guest)).lines[0]!.quantity).toBe(1);
});

test("adet değiştirme ve sıfırla silme", async () => {
  const { variants } = await makeProduct();
  await addToCart(guest, variants[0]!.id);
  const lineId = (await getCart(guest)).lines[0]!.id;
  expect((await setQuantity(guest, lineId, 3)).ok).toBe(true);
  expect((await getCart(guest)).itemCount).toBe(3);
  expect((await setQuantity(guest, lineId, 6)).ok).toBe(false);
  await setQuantity(guest, lineId, 0);
  expect((await getCart(guest)).lines).toHaveLength(0);
});

test("misafir sepeti girişte kullanıcının sepetine birleşir", async () => {
  const user = await makeUser();
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 9 }, { size: "41", stock: 9 }] });
  await addToCart({ userId: user.id }, variants[0]!.id, 4);
  await addToCart(guest, variants[0]!.id, 3);
  await addToCart(guest, variants[1]!.id, 1);
  await mergeGuestCart(guest.guestToken, user.id);
  const cart = await getCart({ userId: user.id });
  expect(cart.lines.map((l) => [l.size, l.quantity])).toEqual([["40", 5], ["41", 1]]);
  expect((await getCart(guest)).lines).toHaveLength(0);
});

test("ücretsiz kargo eşiği", async () => {
  await updateSettings({ shippingFee: 5000, freeShippingThreshold: 200000 });
  const { variants } = await makeProduct({ price: 100000, sizes: [{ size: "40", stock: 5 }] });
  await addToCart(guest, variants[0]!.id, 1);
  expect((await getCart(guest)).shippingFee).toBe(5000);
  await addToCart(guest, variants[0]!.id, 1);
  const cart = await getCart(guest);
  expect(cart.shippingFee).toBe(0);
  expect(cart.total).toBe(200000);
  expect((await getCart(null)).total).toBe(0);
});
