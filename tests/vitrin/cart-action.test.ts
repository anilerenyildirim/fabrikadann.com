import { beforeEach, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { rateLimit } from "@/server/auth/rate-limit";
import { getCart } from "@/server/services/cart";
import { makeProduct, resetDb } from "../helpers/db";

// İstek bağlamı (çerezler, başlıklar) Server Action dışında yok; sahte bir istek kuruyoruz
const jar = new Map<string, string>();
const requestHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => ({ get: (name: string) => requestHeaders.get(name.toLowerCase()) ?? null }),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const { addToCartAction } = await import("@/app/(magaza)/actions/cart");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

async function guestCart() {
  const token = [...jar.values()][0];
  return token ? getCart({ guestToken: token }) : null;
}

beforeEach(async () => {
  await resetDb();
  jar.clear();
  requestHeaders.clear();
  requestHeaders.set("x-forwarded-for", "203.0.113.7");
  revalidatePath.mockClear();
});

test("numara seçilmeden eklenmez; sepet ve çerez oluşmaz", async () => {
  const attempts: Record<string, string>[] = [{}, { variantId: "" }, { variantId: "40" }, { variantId: "' OR 1=1 --" }];
  for (const values of attempts) {
    const state = await addToCartAction({}, form(values));
    expect(state.ok).toBe(false);
    expect(state.error).toBe("Önce numaranızı seçin.");
  }
  expect(jar.size).toBe(0);
  expect(revalidatePath).not.toHaveBeenCalled();
});

test("geçerli numara misafir sepetine eklenir, başlık yenilenir", async () => {
  const { variants } = await makeProduct({ price: 189900, sizes: [{ size: "40", stock: 3 }] });
  const state = await addToCartAction({}, form({ variantId: variants[0]!.id }));
  expect(state).toEqual({ ok: true, message: "Sepete eklendi." });
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");

  const cart = await guestCart();
  expect(cart?.itemCount).toBe(1);
  expect(cart?.subtotal).toBe(189900);
});

test("istemciden gelen fiyat alanı yok sayılır", async () => {
  const { variants } = await makeProduct({ price: 100000 });
  await addToCartAction({}, form({ variantId: variants[0]!.id, price: "1", unitPrice: "1", total: "1" }));
  expect((await guestCart())?.subtotal).toBe(100000);
});

test("adet 1..5 tam sayı", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 10 }] });
  const id = variants[0]!.id;
  for (const quantity of ["0", "6", "1.5", "-1", "abc"]) {
    expect((await addToCartAction({}, form({ variantId: id, quantity }))).ok).toBe(false);
  }
  expect((await addToCartAction({}, form({ variantId: id, quantity: "2" }))).ok).toBe(true);
  expect((await guestCart())?.itemCount).toBe(2);
});

test("tükenen numara ve satışta olmayan ürün eklenmez", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 0 }] });
  expect(await addToCartAction({}, form({ variantId: variants[0]!.id }))).toMatchObject({
    ok: false,
    error: "Bu numara tükendi.",
  });
  const { variants: draft } = await makeProduct({ status: "draft" });
  expect(await addToCartAction({}, form({ variantId: draft[0]!.id }))).toMatchObject({
    ok: false,
    error: "Bu ürün artık satışta değil.",
  });
  // Var olmayan varyant
  expect(
    (await addToCartAction({}, form({ variantId: "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b" }))).ok,
  ).toBe(false);
  expect(revalidatePath).not.toHaveBeenCalled();
});

test("IP başına dakikada 60 ekleme sınırı", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }] });
  for (let i = 0; i < 60; i++) await rateLimit("sepet:203.0.113.7", 60, 60);
  const state = await addToCartAction({}, form({ variantId: variants[0]!.id }));
  expect(state.ok).toBe(false);
  expect(state.error).toMatch(/bir dakika/i);
  expect(await guestCart()).toBeNull();

  // Başka IP etkilenmez
  requestHeaders.set("x-forwarded-for", "198.51.100.2");
  expect((await addToCartAction({}, form({ variantId: variants[0]!.id }))).ok).toBe(true);
  const [row] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM rate_limits`)).rows;
  expect(row?.n).toBe(2);
});
