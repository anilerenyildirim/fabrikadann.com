import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getProductBySlug, listAvailableSizes, listProducts } from "@/server/services/catalog";
import { makeProduct, resetDb } from "../helpers/db";

beforeEach(resetDb);

test("taslak ve arşiv ürünler listelenmez, detayları açılmaz", async () => {
  const { product: active } = await makeProduct({ name: "Açık" });
  const { product: draft } = await makeProduct({ name: "Taslak", status: "draft" });
  await makeProduct({ name: "Arşiv", status: "archived" });
  const { items, total } = await listProducts();
  expect(items.map((p) => p.id)).toEqual([active.id]);
  expect(total).toBe(1);
  expect(await getProductBySlug(draft.slug)).toBeNull();
  expect(await getProductBySlug(active.slug)).not.toBeNull();
});

test("numara filtresi yalnızca stoklu numarayı eşler", async () => {
  const { product: a } = await makeProduct({ sizes: [{ size: "40", stock: 0 }, { size: "41", stock: 2 }] });
  await makeProduct({ sizes: [{ size: "38", stock: 3 }] });
  expect((await listProducts({ sizes: ["40"] })).items).toHaveLength(0);
  expect((await listProducts({ sizes: ["41"] })).items.map((p) => p.id)).toEqual([a.id]);
  expect(await listAvailableSizes()).toEqual(["38", "41"]);
});

test("arama Türkçe büyük/küçük harf ve ı/i farkını yok sayar", async () => {
  const { product } = await makeProduct({ name: "İnce Taban Ayakkabı" });
  await makeProduct({ name: "Bot" });
  for (const q of ["İNCE", "ince", "ayakkabi", "AYAKKABI", "taban"]) {
    expect((await listProducts({ q })).items.map((p) => p.id), q).toEqual([product.id]);
  }
  expect((await listProducts({ q: "%" })).items).toHaveLength(0);
});

test("fiyata göre sıralama", async () => {
  await makeProduct({ name: "Pahalı", price: 300000 });
  await makeProduct({ name: "Ucuz", price: 100000 });
  await makeProduct({ name: "Orta", price: 200000 });
  expect((await listProducts({ sort: "price_asc" })).items.map((p) => p.name)).toEqual(["Ucuz", "Orta", "Pahalı"]);
  expect((await listProducts({ sort: "price_desc" })).items.map((p) => p.name)).toEqual(["Pahalı", "Orta", "Ucuz"]);
});

test("kategori filtresi", async () => {
  const [cat] = await db.insert(schema.categories).values({ name: "Kadın", slug: "kadin" }).returning();
  const { product } = await makeProduct({ categoryId: cat!.id });
  await makeProduct();
  expect((await listProducts({ categorySlug: "kadin" })).items.map((p) => p.id)).toEqual([product.id]);
});

test("ürün detayı kesin stok sayısını değil durumunu verir, numaralar sıralı", async () => {
  const { product } = await makeProduct({
    sizes: [{ size: "41", stock: 10 }, { size: "39", stock: 1 }, { size: "40", stock: 0 }],
  });
  const detail = (await getProductBySlug(product.slug))!;
  const v = detail.colors[0]!.variants;
  expect(v.map((x) => x.size)).toEqual(["39", "40", "41"]);
  expect(v.map((x) => x.availability)).toEqual(["low", "out", "in_stock"]);
  expect(v[0]).not.toHaveProperty("stock");
});

test("stoğu biten ürün listede stoksuz görünür", async () => {
  const { product, variants } = await makeProduct({ sizes: [{ size: "40", stock: 1 }] });
  await db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.id, variants[0]!.id));
  const card = (await listProducts()).items.find((p) => p.id === product.id)!;
  expect(card.inStock).toBe(false);
});
