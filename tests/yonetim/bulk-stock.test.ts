import { beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { bulkUpdateVariants, parseBulkText } from "@/server/services/admin/bulk-stock";
import { AdminAccessError, type AdminContext } from "@/server/services/admin/context";
import { makeProduct, makeUser, resetDb } from "../helpers/db";
import { orderFor } from "../helpers/order";

let ctx: AdminContext;
beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: "admin" });
  ctx = { actorId: admin.id, ip: "10.0.0.1" };
});

const variant = async (sku: string) => (await db.select().from(schema.variants).where(eq(schema.variants.sku, sku)))[0]!;

describe("ayrıştırma", () => {
  test("sekme, noktalı virgül ve virgül; başlık ve boş satırlar atlanır; boş alan değişmez", () => {
    const { lines, errors } = parseBulkText("SKU;Barkod;Stok\n\nfd-1;8680000000017;12\nFD-2\t8680000000024\t\nFD-3,,3\n# not");
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      { line: 3, sku: "FD-1", barcode: "8680000000017", stock: 12 },
      { line: 4, sku: "FD-2", barcode: "8680000000024" },
      { line: 5, sku: "FD-3", stock: 3 },
    ]);
  });

  test("hatalar satır numarasıyla döner", () => {
    const { errors } = parseBulkText("FD-1;12;\nFD-2;;-1\nFD-3\nFD 4;8680000000017\nFD-5;868<script>;1");
    expect(errors).toHaveLength(5);
    expect(errors[0]).toMatch(/^1\. satır: barkod/);
    expect(errors[1]).toMatch(/^2\. satır: stok/);
    expect(errors[2]).toMatch(/^3\. satır: barkod ya da stok/);
    expect(errors[3]).toMatch(/^4\. satır/);
    expect(errors[4]).toMatch(/^5\. satır: barkod/);
  });

  test("çok uzun liste reddedilir", () => {
    const text = Array.from({ length: 3001 }, (_, i) => `FD-${i};;1`).join("\n");
    expect(parseBulkText(text).errors[0]).toMatch(/En fazla 3000 satır/);
  });
});

describe("toplu güncelleme", () => {
  test("önizleme değişiklikleri gösterir ama yazmaz; uygulama hepsini yazar ve kaydeder", async () => {
    const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }, { size: "41", stock: 2 }] });
    const [a, b] = variants;
    const text = `${a!.sku};8680000000017;9\n${b!.sku};8680000000024;`;
    const preview = await bulkUpdateVariants({ text, mode: "available", note: "Açılış sayımı", apply: false }, ctx);
    expect(preview).toMatchObject({ errors: [], barcodeChanges: 2, stockChanges: 1, applied: false });
    expect((await variant(a!.sku)).barcode).toBeNull();

    const done = await bulkUpdateVariants({ text, mode: "available", note: "Açılış sayımı", apply: true }, ctx);
    expect(done.applied).toBe(true);
    expect(await variant(a!.sku)).toMatchObject({ barcode: "8680000000017", stock: 9 });
    expect(await variant(b!.sku)).toMatchObject({ barcode: "8680000000024", stock: 2 });
    const [movement] = await db.select().from(schema.stockMovements);
    expect(movement).toMatchObject({ delta: 4, reason: "manual", note: "Açılış sayımı" });
    const [log] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "variant.bulk_update"));
    expect(log!.data).toMatchObject({ barcodeChanges: 2, stockChanges: 1 });
  });

  test("bir satır hatalıysa hiçbir şey yazılmaz", async () => {
    const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }] });
    const text = `${variants[0]!.sku};8680000000017;9\nYOK-SKU;8680000000031;1`;
    const r = await bulkUpdateVariants({ text, mode: "available", note: "Sayım", apply: true }, ctx);
    expect(r.applied).toBe(false);
    expect(r.errors).toEqual(["2. satır: YOK-SKU SKU'su bulunamadı."]);
    expect(await variant(variants[0]!.sku)).toMatchObject({ barcode: null, stock: 5 });
  });

  test("başka numaradaki barkod reddedilir; liste içinde barkod takası yapılabilir", async () => {
    const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 1 }, { size: "41", stock: 1 }, { size: "42", stock: 1 }] });
    const [a, b, c] = variants;
    await db.update(schema.variants).set({ barcode: "AAAA1" }).where(eq(schema.variants.id, a!.id));
    await db.update(schema.variants).set({ barcode: "BBBB1" }).where(eq(schema.variants.id, b!.id));

    const clash = await bulkUpdateVariants({ text: `${c!.sku};AAAA1`, mode: "available", note: "", apply: true }, ctx);
    expect(clash.errors[0]).toMatch(/AAAA1 barkodu .* numarasında kullanılıyor/);

    const swap = await bulkUpdateVariants({ text: `${a!.sku};BBBB1\n${b!.sku};AAAA1`, mode: "available", note: "", apply: true }, ctx);
    expect(swap.applied).toBe(true);
    expect((await variant(a!.sku)).barcode).toBe("BBBB1");
    expect((await variant(b!.sku)).barcode).toBe("AAAA1");
  });

  test("aynı SKU ya da barkod iki satırda olamaz; stok değişirse sebep zorunlu", async () => {
    const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 1 }, { size: "41", stock: 1 }] });
    const [a, b] = variants;
    const dup = await bulkUpdateVariants({ text: `${a!.sku};;2\n${a!.sku};;3\n${b!.sku};X1234;\n${a!.sku}x;X1234`, mode: "available", note: "Sayım", apply: false }, ctx);
    expect(dup.errors.some((e) => e.includes("SKU'su 1. satırda da var"))).toBe(true);
    expect(dup.errors.some((e) => e.includes("X1234 barkodu 3. satırda da var"))).toBe(true);
    const noNote = await bulkUpdateVariants({ text: `${a!.sku};;7`, mode: "available", note: "", apply: true }, ctx);
    expect(noNote.applied).toBe(false);
    expect(noNote.errors[0]).toMatch(/sebebini/);
  });

  test("depo sayımı bekleyen siparişlerde ayrılmış adetleri düşer", async () => {
    const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }] });
    await orderFor({ guestToken: "g" }, variants[0]!.id, 2);
    const r = await bulkUpdateVariants({ text: `${variants[0]!.sku};;10`, mode: "physical", note: "Sayım", apply: true }, ctx);
    expect(r.applied).toBe(true);
    expect((await variant(variants[0]!.sku)).stock).toBe(8);
  });

  test("yönetici olmayan kullanamaz", async () => {
    const user = await makeUser();
    await expect(
      bulkUpdateVariants({ text: "FD-1;;1", mode: "available", note: "x", apply: true }, { actorId: user.id, ip: "1.1.1.1" }),
    ).rejects.toBeInstanceOf(AdminAccessError);
  });
});
