import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getProductBySlug } from "@/server/services/catalog";
import { inventoryValue } from "@/server/services/admin/accounting";
import { AdminAccessError, type AdminContext } from "@/server/services/admin/context";
import { createManufacturer, getProductSupply, updateManufacturer } from "@/server/services/admin/manufacturers";
import { createPurchase, istanbulDate } from "@/server/services/admin/purchases";
import { bulkUpdateSupply, listSupplyRows, SupplyError, supplyCounts } from "@/server/services/admin/supply";
import { makeProduct, makeUser, resetDb } from "../helpers/db";

let ctx: AdminContext;

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: "admin" });
  ctx = { actorId: admin.id, ip: "10.0.0.1" };
});

test("toplu giriş yalnızca değişen satırları yazar, günlüğe geçer, muhasebe uyarısı kalkar", async () => {
  const m = await createManufacturer({ name: "Atölye A" }, ctx);
  const a = await makeProduct({ price: 150000 });
  const b = await makeProduct({ price: 200000 });
  expect(await supplyCounts()).toEqual({ total: 2, missing: 2 });
  expect((await inventoryValue()).productsWithoutManufacturer).toBe(2);

  const r = await bulkUpdateSupply(
    [
      { productId: a.product.id, manufacturerId: m.id, purchasePrice: 80000 },
      { productId: b.product.id, manufacturerId: null, purchasePrice: null },
    ],
    ctx,
  );
  expect(r.changed).toBe(1);
  expect(await getProductSupply(a.product.id)).toEqual({ manufacturerId: m.id, purchasePrice: 80000 });
  expect(await supplyCounts()).toEqual({ total: 2, missing: 1 });
  expect((await listSupplyRows({ missingOnly: true })).map((x) => x.productId)).toEqual([b.product.id]);

  const logs = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "product.supply_bulk"));
  expect(logs).toHaveLength(1);
  expect(logs[0]!.target).toBe(a.product.id);

  // Aynı değerler yeniden gönderilirse değişiklik sayılmaz
  expect((await bulkUpdateSupply([{ productId: a.product.id, manufacturerId: m.id, purchasePrice: 80000 }], ctx)).changed).toBe(0);
});

test("alış fişi olan ürünün üreticisi değişmez; hata varsa hiçbir satır kaydedilmez", async () => {
  const m1 = await createManufacturer({ name: "Atölye A" }, ctx);
  const m2 = await createManufacturer({ name: "Atölye B" }, ctx);
  const a = await makeProduct({ price: 150000, sizes: [{ size: "40", stock: 0 }] });
  const b = await makeProduct({ price: 150000 });
  await bulkUpdateSupply([{ productId: a.product.id, manufacturerId: m1.id, purchasePrice: 80000 }], ctx);
  await createPurchase(
    { kind: "purchase", manufacturerId: m1.id, date: istanbulDate(), lines: [{ variantId: a.variants[0]!.id, quantity: 3, unitCost: 80000 }] },
    ctx,
  );
  expect((await listSupplyRows()).find((x) => x.productId === a.product.id)!.locked).toBe(true);

  const attempt = bulkUpdateSupply(
    [
      { productId: b.product.id, manufacturerId: m2.id, purchasePrice: 50000 },
      { productId: a.product.id, manufacturerId: m2.id, purchasePrice: 80000 },
    ],
    ctx,
  );
  await expect(attempt).rejects.toBeInstanceOf(SupplyError);
  await expect(attempt).rejects.toMatchObject({ field: `satir-${a.product.id}` });
  // b de yazılmadı (tek işlem)
  expect(await getProductSupply(b.product.id)).toEqual({ manufacturerId: null, purchasePrice: null });

  // Kilitli üründe alış fiyatı yine değiştirilebilir
  expect((await bulkUpdateSupply([{ productId: a.product.id, manufacturerId: m1.id, purchasePrice: 85000 }], ctx)).changed).toBe(1);
});

test("pasif üretici yeni atanamaz; alış fiyatı vitrine çıkmaz; yönetici olmayan reddedilir", async () => {
  const m = await createManufacturer({ name: "Eski Atölye" }, ctx);
  await updateManufacturer(m.id, { name: "Eski Atölye", active: false }, ctx);
  const a = await makeProduct({ price: 150000 });
  await expect(
    bulkUpdateSupply([{ productId: a.product.id, manufacturerId: m.id, purchasePrice: null }], ctx),
  ).rejects.toThrow(/pasif/);

  const m2 = await createManufacturer({ name: "Yeni Atölye" }, ctx);
  await bulkUpdateSupply([{ productId: a.product.id, manufacturerId: m2.id, purchasePrice: 81234 }], ctx);
  const storefront = await getProductBySlug(a.product.slug);
  expect(JSON.stringify(storefront)).not.toContain("81234");
  expect(JSON.stringify(storefront)).not.toContain(m2.id);

  const customer = await makeUser();
  await expect(
    bulkUpdateSupply([{ productId: a.product.id, manufacturerId: null, purchasePrice: null }], { actorId: customer.id }),
  ).rejects.toBeInstanceOf(AdminAccessError);
});
