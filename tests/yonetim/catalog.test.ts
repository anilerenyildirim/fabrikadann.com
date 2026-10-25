import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { MAX_UPLOAD_BYTES } from "@/server/storage/images";
import {
  addColor,
  addProductImage,
  addVariants,
  adjustVariantStock,
  buildSku,
  createCategory,
  createProduct,
  deleteCategory,
  deleteColor,
  deleteImage,
  deleteVariant,
  getAdminProduct,
  listAdminCategories,
  listAdminProducts,
  moveCategory,
  moveColor,
  parseSizeInput,
  setProductStatus,
  updateCategory,
  updateProduct,
  updateVariant,
} from "@/server/services/admin/catalog";
import { AdminAccessError, AdminError, type AdminContext } from "@/server/services/admin/context";
import { makeProduct, makeUser, resetDb } from "../helpers/db";
import { orderFor } from "../helpers/order";

let uploadDir: string;
let ctx: AdminContext;

beforeAll(async () => {
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "fd-yonetim-"));
  process.env.UPLOAD_DIR = uploadDir;
});

afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: "admin" });
  ctx = { actorId: admin.id, ip: "10.0.0.1" };
});

const base = { price: 129990, trendyolPrice: null, categoryId: null, status: "draft" as const, featured: false };

async function png(width = 400, height = 500) {
  return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 20, b: 20 } } })
    .png()
    .toBuffer();
}

async function auditActions() {
  return (await db.select({ action: schema.auditLog.action }).from(schema.auditLog)).map((r) => r.action);
}

describe("ürün adresi (slug)", () => {
  test("addan üretilir, çakışmada -2, -3 eklenir", async () => {
    const a = await createProduct({ ...base, name: "Şık Çizme" }, ctx);
    const b = await createProduct({ ...base, name: "Şık Çizme" }, ctx);
    const c = await createProduct({ ...base, name: "ŞIK ÇİZME", slug: "" }, ctx);
    expect([a.slug, b.slug, c.slug]).toEqual(["sik-cizme", "sik-cizme-2", "sik-cizme-3"]);
    expect(await auditActions()).toEqual(["product.create", "product.create", "product.create"]);
  });

  test("düzenlemede elle yazılan adres başka üründe varsa reddedilir", async () => {
    const a = await createProduct({ ...base, name: "Bot" }, ctx);
    const b = await createProduct({ ...base, name: "Loafer" }, ctx);
    await expect(updateProduct(b.id, { ...base, name: "Loafer", slug: a.slug }, ctx)).rejects.toMatchObject({
      field: "slug",
    });
    const updated = await updateProduct(b.id, { ...base, name: "Loafer", slug: "Yeni Loafer" }, ctx);
    expect(updated.slug).toBe("yeni-loafer");
  });

  test("bilgiler kaydedilirken ekranda görülen durum eskiyse durum geri alınmaz", async () => {
    const { product, variants } = await makeProduct({ status: "draft" });
    await addProductImage(variants[0]!.colorId, await png(), "", ctx);
    const form = { ...base, name: "Yeni ad", status: "draft" as const };
    // Form "Taslak" iken açıldı; bu arada üstteki düğmeyle yayına alındı
    await setProductStatus(product.id, "active", ctx);
    await updateProduct(product.id, form, ctx, { statusShown: "draft" });
    let [row] = await db.select().from(schema.products).where(eq(schema.products.id, product.id));
    expect(row).toMatchObject({ name: "Yeni ad", status: "active" });
    // Kullanıcı durumu kutudan bilerek değiştirirse uygulanır
    await updateProduct(product.id, { ...form, status: "archived" }, ctx, { statusShown: "active" });
    [row] = await db.select().from(schema.products).where(eq(schema.products.id, product.id));
    expect(row!.status).toBe("archived");
    // statusShown verilmezse gönderilen durum yazılır (API ve eski davranış)
    await updateProduct(product.id, form, ctx);
    [row] = await db.select().from(schema.products).where(eq(schema.products.id, product.id));
    expect(row!.status).toBe("draft");
  });

  test("Trendyol fiyatı site fiyatından düşükse reddedilir", async () => {
    await expect(createProduct({ ...base, name: "X", trendyolPrice: 100000 }, ctx)).rejects.toMatchObject({
      field: "trendyolPrice",
    });
  });

  test("yeni ürün doğrudan yayında oluşturulamaz", async () => {
    await expect(createProduct({ ...base, name: "X", status: "active" }, ctx)).rejects.toBeInstanceOf(AdminError);
  });
});

describe("numara girişi", () => {
  test("aralık, liste ve yarım numaralar", () => {
    expect(parseSizeInput("36-41")).toEqual(["36", "37", "38", "39", "40", "41"]);
    expect(parseSizeInput("38, 38.5")).toEqual(["38", "38.5"]);
    expect(parseSizeInput("40 39  38.5;41")).toEqual(["38.5", "39", "40", "41"]);
    expect(parseSizeInput("36–38, 37.5, 37")).toEqual(["36", "37", "37.5", "38"]);
    expect(parseSizeInput("38.0")).toEqual(["38"]);
  });

  test("hatalı girişler açık mesajla reddedilir", () => {
    for (const bad of ["", "abc", "41-36", "38.25", "38,5", "70", "36-", "36-41-42"]) {
      expect(() => parseSizeInput(bad), bad).toThrow(AdminError);
    }
  });

  test("virgüllü yarım numara (38,5) için noktayla yazma önerilir; 40,50 iki numaradır", () => {
    expect(() => parseSizeInput("38,5")).toThrow(/noktayla yazın: 38\.5/);
    expect(() => parseSizeInput("37, 37,5")).toThrow(/37\.5/);
    expect(parseSizeInput("40,50")).toEqual(["40", "50"]);
  });
});

describe("renk, numara ve SKU", () => {
  test("SKU otomatik üretilir, benzersizdir; çakışan SKU elle girilemez", async () => {
    const p = await createProduct({ ...base, name: "Sneaker" }, ctx);
    const black = await addColor(p.id, "Siyah", ctx);
    const white = await addColor(p.id, "Beyaz", ctx);
    await expect(addColor(p.id, "siyah", ctx)).rejects.toMatchObject({ field: "name" });

    const r = await addVariants(black.id, "38-40", 3, ctx);
    expect(r).toEqual({ added: ["38", "39", "40"], skipped: [] });
    expect(await addVariants(black.id, "40, 40.5", 0, ctx)).toEqual({ added: ["40.5"], skipped: ["40"] });
    await addVariants(white.id, "38", 0, ctx);

    const product = (await getAdminProduct(p.id))!;
    const [blackColor, whiteColor] = product.colors;
    expect(blackColor!.variants.map((v) => v.size)).toEqual(["38", "39", "40", "40.5"]);
    expect(blackColor!.variants[0]!.sku).toBe(buildSku(p.id, 0, "38"));
    expect(blackColor!.variants[0]!.sku).toMatch(/^FD-[0-9A-F]{6}-1-38$/);
    expect(whiteColor!.variants[0]!.sku).toBe(buildSku(p.id, 1, "38"));
    expect(blackColor!.variants[0]!.stock).toBe(3);

    // Elle SKU: başka varyantın SKU'su reddedilir, küçük harf büyütülür
    const v38 = blackColor!.variants[0]!;
    const v39 = blackColor!.variants[1]!;
    await expect(updateVariant(v39.id, { sku: v38.sku.toLowerCase(), barcode: "" }, ctx)).rejects.toMatchObject({
      field: "sku",
    });
    await updateVariant(v39.id, { sku: "ozel-sku_39", barcode: "8690000000001" }, ctx);
    const [saved] = await db.select().from(schema.variants).where(eq(schema.variants.id, v39.id));
    expect(saved).toMatchObject({ sku: "OZEL-SKU_39", barcode: "8690000000001" });
    await expect(updateVariant(v38.id, { sku: v38.sku, barcode: "8690000000001" }, ctx)).rejects.toMatchObject({
      field: "barcode",
    });
    await expect(updateVariant(v38.id, { sku: "SKU WITH SPACE", barcode: "" }, ctx)).rejects.toMatchObject({
      field: "sku",
    });
  });

  test("otomatik SKU başka bir varyantta elle kullanılmışsa sonuna ek alır", async () => {
    const p = await createProduct({ ...base, name: "Bot" }, ctx);
    const c = await addColor(p.id, "Siyah", ctx);
    await addVariants(c.id, "39", 0, ctx);
    const [v39] = await db.select().from(schema.variants);
    await updateVariant(v39!.id, { sku: buildSku(p.id, 0, "40"), barcode: "" }, ctx);
    await addVariants(c.id, "40", 0, ctx);
    const [v40] = await db.select().from(schema.variants).where(eq(schema.variants.size, "40"));
    expect(v40!.sku).toBe(`${buildSku(p.id, 0, "40")}-2`);
  });

  test("renkler yeniden sıralanır", async () => {
    const p = await createProduct({ ...base, name: "Bot" }, ctx);
    const a = await addColor(p.id, "Siyah", ctx);
    const b = await addColor(p.id, "Beyaz", ctx);
    await moveColor(b.id, "up", ctx);
    expect((await getAdminProduct(p.id))!.colors.map((c) => c.id)).toEqual([b.id, a.id]);
    await moveColor(b.id, "up", ctx); // zaten en üstte
    expect((await getAdminProduct(p.id))!.colors.map((c) => c.position)).toEqual([0, 1]);
  });

  test("elle stok düzeltmesi not ve kişiyle stok hareketi yazar", async () => {
    const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }] });
    await expect(adjustVariantStock(variants[0]!.id, 3, "", ctx)).rejects.toMatchObject({ field: "note" });
    await expect(adjustVariantStock(variants[0]!.id, -1, "sayım", ctx)).rejects.toMatchObject({ field: "stock" });
    expect(await adjustVariantStock(variants[0]!.id, 2, "Sayım farkı", ctx)).toMatchObject({ from: 5, to: 2 });
    const moves = await db.select().from(schema.stockMovements);
    expect(moves).toMatchObject([{ delta: -3, reason: "manual", note: "Sayım farkı", actorId: ctx.actorId }]);
    const [log] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "stock.adjust"));
    expect(log).toMatchObject({ actorId: ctx.actorId, ip: "10.0.0.1", data: { from: 5, to: 2 } });
  });

  test("ekrandaki stok eskiyse düzeltme reddedilir; depo sayımı ayrılmış adetleri düşer", async () => {
    const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }] });
    const vid = variants[0]!.id;
    await orderFor({ guestToken: "g" }, vid, 2); // satılabilir 3, ayrılmış 2
    await expect(adjustVariantStock(vid, 4, "Sayım farkı", ctx, { expected: 5 })).rejects.toMatchObject({ field: "stock" });
    expect(await adjustVariantStock(vid, 4, "Sayım farkı", ctx, { expected: 3 })).toMatchObject({ from: 3, to: 4 });
    // Depoda 7 çift sayıldı: 2'si bekleyen siparişte → satılabilir 5
    expect(await adjustVariantStock(vid, 7, "Depo sayımı", ctx, { mode: "physical" })).toEqual({
      from: 4,
      to: 5,
      reserved: 2,
      shortfall: 0,
    });
    // Depoda 1 çift: bekleyen siparişe 1 eksik
    expect(await adjustVariantStock(vid, 1, "Depo sayımı", ctx, { mode: "physical" })).toMatchObject({ to: 0, shortfall: 1 });
    const [log] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "stock.adjust"))
      .orderBy(schema.auditLog.createdAt)
      .limit(1)
      .offset(1);
    expect(log!.data).toMatchObject({ mode: "physical", physical: 7, reserved: 2 });
  });

  test("siparişi olan numara ve renk silinemez", async () => {
    const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }, { size: "41", stock: 1 }] });
    await orderFor({ guestToken: "g" }, variants[0]!.id, 1);
    await expect(deleteVariant(variants[0]!.id, ctx)).rejects.toBeInstanceOf(AdminError);
    await expect(deleteColor(variants[0]!.colorId, ctx)).rejects.toBeInstanceOf(AdminError);
    // Siparişsiz numara silinebilir (ürün yayında ama başka numarası var)
    await deleteVariant(variants[1]!.id, ctx);
    expect(await db.select().from(schema.variants)).toHaveLength(1);
  });
});

describe("görseller ve yayın", () => {
  test("görsel olmayan dosya reddedilir", async () => {
    const p = await createProduct({ ...base, name: "Bot" }, ctx);
    const c = await addColor(p.id, "Siyah", ctx);
    const err = await addProductImage(c.id, Buffer.from("<script>alert(1)</script>"), "", ctx).catch((e) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect(err.message).toMatch(/görsel değil/);
    expect(err.field).toBe("file");
    expect(await db.select().from(schema.productImages)).toHaveLength(0);
  });

  test("10 MB üstü dosya reddedilir", async () => {
    const p = await createProduct({ ...base, name: "Bot" }, ctx);
    const c = await addColor(p.id, "Siyah", ctx);
    const err = await addProductImage(c.id, Buffer.alloc(MAX_UPLOAD_BYTES + 1, 1), "", ctx).catch((e) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect(err.message).toMatch(/10 MB/);
  });

  test("yayına almak için görsel ve numara gerekir; yayındaki ürünün son görseli silinemez", async () => {
    const p = await createProduct({ ...base, name: "Bot" }, ctx);
    await expect(setProductStatus(p.id, "active", ctx)).rejects.toMatchObject({ field: "status" });
    const c = await addColor(p.id, "Siyah", ctx);
    const first = await addProductImage(c.id, await png(), "Siyah bot yandan", ctx);
    await expect(setProductStatus(p.id, "active", ctx)).rejects.toThrow(/numara/);
    await addVariants(c.id, "40", 1, ctx);
    await setProductStatus(p.id, "active", ctx);

    const second = await addProductImage(c.id, await png(600, 750), "", ctx);
    const imgs = (await getAdminProduct(p.id))!.colors[0]!.images;
    expect(imgs.map((i) => [i.id, i.position])).toEqual([
      [first.id, 0],
      [second.id, 1],
    ]);
    expect(imgs[0]).toMatchObject({ alt: "Siyah bot yandan", width: 400, height: 500 });

    await deleteImage(second.id, ctx);
    await expect(deleteImage(first.id, ctx)).rejects.toBeInstanceOf(AdminError);
    await setProductStatus(p.id, "draft", ctx);
    await deleteImage(first.id, ctx);
    expect(await db.select().from(schema.productImages)).toHaveLength(0);
    expect(await auditActions()).toEqual(
      expect.arrayContaining(["image.create", "image.delete", "product.status", "variant.create"]),
    );
  });

  test("arşivlenen ürün listede durum filtresiyle görünür", async () => {
    const p = await createProduct({ ...base, name: "Eski Model" }, ctx);
    await setProductStatus(p.id, "archived", ctx);
    expect((await listAdminProducts({ status: "archived" })).map((r) => r.id)).toEqual([p.id]);
    expect(await listAdminProducts({ status: "draft" })).toHaveLength(0);
    expect((await listAdminProducts({ q: "ESKİ" })).map((r) => r.id)).toEqual([p.id]);
  });
});

describe("kategoriler", () => {
  test("adres benzersiz, sıralama ve silme", async () => {
    const a = await createCategory({ name: "Kadın" }, ctx);
    const b = await createCategory({ name: "Kadın" }, ctx);
    expect([a.slug, b.slug]).toEqual(["kadin", "kadin-2"]);
    await expect(createCategory({ name: "Başka", slug: "kadin" }, ctx)).rejects.toMatchObject({ field: "slug" });
    await expect(updateCategory(b.id, { name: "Erkek", slug: "kadin" }, ctx)).rejects.toMatchObject({ field: "slug" });
    await updateCategory(b.id, { name: "Erkek", slug: "erkek" }, ctx);
    await moveCategory(b.id, "up", ctx);
    expect((await listAdminCategories()).map((c) => c.slug)).toEqual(["erkek", "kadin"]);

    const { product } = await makeProduct({ categoryId: a.id });
    await makeProduct({ categoryId: a.id });
    expect((await listAdminCategories()).map((c) => [c.slug, c.productCount])).toEqual([
      ["erkek", 0],
      ["kadin", 2],
    ]);
    expect(await deleteCategory(a.id, ctx)).toEqual({ detached: 2 });
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, product.id));
    expect(p!.categoryId).toBeNull();
  });
});

describe("yetki", () => {
  test("yönetici olmayan kullanıcı yönetim servislerini çağıramaz", async () => {
    const customer = await makeUser({ role: "customer" });
    const bad: AdminContext = { actorId: customer.id };
    const ghost: AdminContext = { actorId: "00000000-0000-4000-8000-000000000000" };
    const { product, variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }] });
    for (const c of [bad, ghost, { actorId: "' or 1=1 --" }]) {
      await expect(createProduct({ ...base, name: "Kötü" }, c)).rejects.toBeInstanceOf(AdminAccessError);
      await expect(setProductStatus(product.id, "archived", c)).rejects.toBeInstanceOf(AdminAccessError);
      await expect(adjustVariantStock(variants[0]!.id, 0, "deneme", c)).rejects.toBeInstanceOf(AdminAccessError);
      await expect(createCategory({ name: "X" }, c)).rejects.toBeInstanceOf(AdminAccessError);
    }
    const [v] = await db.select().from(schema.variants).where(and(eq(schema.variants.id, variants[0]!.id)));
    expect(v!.stock).toBe(5);
    expect(await db.select().from(schema.auditLog)).toHaveLength(0);
  });

  test("geçersiz kimlikler hata verir, veritabanına gitmez", async () => {
    await expect(setProductStatus("../../etc", "archived", ctx)).rejects.toBeInstanceOf(AdminError);
    await expect(addColor("nope", "Siyah", ctx)).rejects.toBeInstanceOf(AdminError);
    expect(await getAdminProduct("nope")).toBeNull();
  });
});
