import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import type { N11Attribute, N11Sku } from "@/server/marketplaces/n11/client";
import { AdminAccessError, AdminError, type AdminContext } from "@/server/services/admin/context";
import {
  listN11Products,
  refreshN11Categories,
  saveCategoryMapping,
  searchN11Categories,
  sendProductToN11,
  type N11Api,
} from "@/server/services/admin/n11";
import { updateSettings } from "@/server/services/settings";
import { makeProduct, makeUser, resetDb } from "../helpers/db";

const ATTRS: N11Attribute[] = [
  { id: 1, name: "Marka", mandatory: true, variant: false, slicer: false, custom: true, values: [] },
  { id: 22, name: "Cinsiyet", mandatory: true, variant: false, slicer: false, custom: false, values: [{ id: 7, value: "Kadın" }] },
  { id: 429, name: "Renk", mandatory: true, variant: false, slicer: true, custom: true, values: [] },
  { id: 847, name: "Numara", mandatory: true, variant: true, slicer: false, custom: false, values: [{ id: 380, value: "38" }, { id: 390, value: "39" }] },
];

class FakeN11 implements N11Api {
  created: N11Sku[][] = [];
  taskSeq = 100;
  reject = false;
  async categories() {
    return [
      { id: 1001799, path: "Ayakkabı & Çanta > Kadın Ayakkabı > Kadın Bot & Çizme > Kadın Bot" },
      { id: 1214235, path: "Ayakkabı & Çanta > Erkek Ayakkabı > Erkek Bot & Çizme > Erkek Bot" },
    ];
  }
  async categoryAttributes() {
    return ATTRS;
  }
  async createProducts(skus: N11Sku[]) {
    this.created.push(skus);
    if (this.reject) return { taskId: null, status: "REJECT", reasons: ["Kargo şablonu bulunamadı"] };
    return { taskId: String(++this.taskSeq), status: "IN_QUEUE", reasons: [] };
  }
}

let ctx: AdminContext;
let api: FakeN11;
beforeEach(async () => {
  await resetDb();
  ctx = { actorId: (await makeUser({ role: "admin" })).id };
  api = new FakeN11();
  process.env.APP_URL = "https://fabrikadann.com";
});

async function category(name = "Kadın Bot") {
  const [c] = await db.insert(schema.categories).values({ name, slug: name.toLowerCase().replace(/\s/g, "-") }).returning();
  return c!;
}

async function productIn(categoryId: string, sizes = [{ size: "38", stock: 2 }, { size: "39", stock: 1 }]) {
  const p = await makeProduct({ name: "Deri Bot", categoryId, sizes });
  const [color] = await db.select().from(schema.productColors).where(eq(schema.productColors.productId, p.product.id));
  await db.insert(schema.productImages).values({ colorId: color!.id, storageKey: "p/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", width: 1200, height: 1500 });
  return p;
}

async function mapped() {
  await refreshN11Categories(ctx, api);
  const c = await category();
  await saveCategoryMapping(ctx, api, { categoryId: c.id, externalCategoryId: 1001799, attributes: [{ id: 22, valueId: 7, customValue: null }] });
  return c;
}

test("kategori önbelleği yenilenir ve kelimelerle aranır", async () => {
  expect(await refreshN11Categories(ctx, api)).toBe(2);
  expect((await searchN11Categories("kadın bot")).map((c) => c.externalId)).toEqual([1001799]);
  expect(await refreshN11Categories(ctx, api)).toBe(2);
  expect(await db.select().from(schema.marketplaceCategories)).toHaveLength(2);
});

test("eşleştirmede zorunlu sabit özellik yoksa ya da değer listede değilse hata", async () => {
  await refreshN11Categories(ctx, api);
  const c = await category();
  await expect(saveCategoryMapping(ctx, api, { categoryId: c.id, externalCategoryId: 1001799, attributes: [] })).rejects.toThrow(/Cinsiyet/);
  await expect(
    saveCategoryMapping(ctx, api, { categoryId: c.id, externalCategoryId: 1001799, attributes: [{ id: 22, valueId: 999, customValue: null }] }),
  ).rejects.toBeInstanceOf(AdminError);
  await expect(saveCategoryMapping(ctx, api, { categoryId: c.id, externalCategoryId: 555, attributes: [] })).rejects.toThrow(/N11 kategorisi/);
});

test("kargo şablonu boşken gönderim N11'e istek atmaz", async () => {
  const c = await mapped();
  const { product } = await productIn(c.id);
  const res = await sendProductToN11(ctx, api, product.id);
  expect(res.status).toBe("failed");
  expect(res.message).toMatch(/Teslimat Bilgilerim/);
  expect(api.created).toHaveLength(0);
});

test("gönderim: SKU'lar bekliyor, görev kaydı; ikinci gönderimde yalnız yeni SKU", async () => {
  await updateSettings({ n11ShipmentTemplate: "STANDART" });
  const c = await mapped();
  const { product, variants } = await productIn(c.id);
  const res = await sendProductToN11(ctx, api, product.id);
  expect(res).toMatchObject({ status: "sent", sent: 2 });
  expect(api.created[0]!.map((s) => s.stockCode).sort()).toEqual(variants.map((v) => v.sku).sort());
  expect(api.created[0]![0]!.attributes).toContainEqual({ id: 22, valueId: 7, customValue: null });
  const listings = await db.select().from(schema.marketplaceListings);
  expect(listings.map((l) => [l.status, l.taskId])).toEqual([
    ["pending", "101"],
    ["pending", "101"],
  ]);
  expect(await db.select().from(schema.marketplaceTasks)).toMatchObject([{ channel: "n11", taskId: "101", kind: "create", done: false }]);

  expect((await sendProductToN11(ctx, api, product.id)).status).toBe("nothing");
  // biri başarısız olduysa yalnız o yeniden gider
  await db.update(schema.marketplaceListings).set({ status: "failed", error: "x" }).where(eq(schema.marketplaceListings.variantId, variants[0]!.id));
  expect(await sendProductToN11(ctx, api, product.id)).toMatchObject({ status: "sent", sent: 1 });
  expect(api.created[1]!.map((s) => s.stockCode)).toEqual([variants[0]!.sku]);
});

test("N11 isteği reddederse SKU'lar kaydedilmez, neden döner", async () => {
  await updateSettings({ n11ShipmentTemplate: "YOK" });
  const c = await mapped();
  const { product } = await productIn(c.id);
  api.reject = true;
  expect(await sendProductToN11(ctx, api, product.id)).toMatchObject({ status: "failed", message: "N11 reddetti: Kargo şablonu bulunamadı" });
  expect(await db.select().from(schema.marketplaceListings)).toHaveLength(0);
});

test("eşlenmemiş kategorideki ürün listede gönderilemez görünür", async () => {
  await updateSettings({ n11ShipmentTemplate: "STANDART" });
  const c = await category("Babet");
  const { product } = await productIn(c.id);
  const [row] = await listN11Products();
  expect(row).toMatchObject({ id: product.id, mapped: false, sendable: 0, total: 2 });
  expect((await sendProductToN11(ctx, api, product.id)).message).toMatch(/eşleştir/);
});

test("yönetici olmayan reddedilir", async () => {
  const u = await makeUser();
  await expect(refreshN11Categories({ actorId: u.id }, api)).rejects.toBeInstanceOf(AdminAccessError);
});
