import { beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getProductBySlug } from "@/server/services/catalog";
import {
  accountingSummary,
  inventoryValue,
  manufacturerBalances,
  manufacturerProducts,
  manufacturerStatement,
  monthRange,
} from "@/server/services/admin/accounting";
import { createProduct, getAdminProduct, updateProduct } from "@/server/services/admin/catalog";
import { AdminAccessError, AdminError, type AdminContext } from "@/server/services/admin/context";
import { createLedgerEntry, deleteLedgerEntry } from "@/server/services/admin/ledger";
import {
  createManufacturer,
  deleteManufacturer,
  updateManufacturer,
  writeProductSupply,
} from "@/server/services/admin/manufacturers";
import { createPurchase, getPurchase, istanbulDate, purchaseCatalog } from "@/server/services/admin/purchases";
import { makeProduct, makeUser, resetDb } from "../helpers/db";
import { orderFor } from "../helpers/order";

let ctx: AdminContext;
const today = istanbulDate();

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: "admin" });
  ctx = { actorId: admin.id, ip: "10.0.0.1" };
});

async function supplied(manufacturerId: string, purchasePrice: number | null, sizes = [{ size: "40", stock: 0 }, { size: "41", stock: 0 }]) {
  const made = await makeProduct({ sizes, price: 150000 });
  await writeProductSupply(made.product.id, { manufacturerId, purchasePrice }, db);
  return made;
}

const stockOf = async (variantId: string) =>
  (await db.select({ stock: schema.variants.stock }).from(schema.variants).where(eq(schema.variants.id, variantId)))[0]!.stock;

async function markPaid(orderId: string) {
  await db.update(schema.orders).set({ status: "preparing", paidAt: new Date() }).where(eq(schema.orders.id, orderId));
}

describe("üretim barkodu", () => {
  test("her numaraya otomatik, benzersiz ve geçerli EAN-13 barkodu verilir", async () => {
    const { variants } = await makeProduct({ sizes: [{ size: "38", stock: 1 }, { size: "39", stock: 1 }, { size: "40", stock: 1 }] });
    const codes = variants.map((v) => v.productionBarcode);
    expect(new Set(codes).size).toBe(3);
    for (const code of codes) {
      expect(code).toMatch(/^29\d{11}$/);
      const digits = code.split("").map(Number);
      const sum = digits.slice(0, 12).reduce((s, d, i) => s + d * (i % 2 === 0 ? 1 : 3), 0);
      expect((10 - (sum % 10)) % 10).toBe(digits[12]);
    }
  });
});

describe("üreticiler", () => {
  test("ekleme, aynı adın reddi, güncelleme; geçmişi olan üretici silinmez", async () => {
    const { id } = await createManufacturer({ name: "Deri Atölyesi", iban: "tr12 0006 2000 0000 0000 0000 01", taxNumber: "1234567890" }, ctx);
    await expect(createManufacturer({ name: "deri atölyesi" }, ctx)).rejects.toMatchObject({ field: "name" });
    await expect(createManufacturer({ name: "X", iban: "DE123" }, ctx)).rejects.toMatchObject({ field: "iban" });
    await updateManufacturer(id, { name: "Deri Atölyesi", iban: "TR120006200000000000000001", openingBalance: 500000 }, ctx);
    await expect(deleteManufacturer(id, ctx)).rejects.toBeInstanceOf(AdminError);

    const other = await createManufacturer({ name: "Boş Üretici" }, ctx);
    await deleteManufacturer(other.id, ctx);
    const rows = await db.select().from(schema.manufacturers);
    expect(rows.map((r) => r.name)).toEqual(["Deri Atölyesi"]);
    expect(rows[0]!.iban).toBe("TR120006200000000000000001");
  });

  test("yönetici olmayan üretici ekleyemez", async () => {
    const customer = await makeUser();
    await expect(createManufacturer({ name: "X" }, { actorId: customer.id })).rejects.toBeInstanceOf(AdminAccessError);
  });
});

describe("ürünün üreticisi ve alış fiyatı", () => {
  test("yeni üründe üretici zorunlu; alış fiyatı ayrı tabloda tutulur ve vitrine çıkmaz", async () => {
    const m = await createManufacturer({ name: "Atölye" }, ctx);
    await expect(createProduct({ name: "Bot", price: 200000 }, ctx)).rejects.toMatchObject({ field: "manufacturerId" });
    const { id, slug } = await createProduct({ name: "Bot", price: 200000, manufacturerId: m.id, purchasePrice: 90000 }, ctx);
    const admin = await getAdminProduct(id);
    expect(admin).toMatchObject({ manufacturerId: m.id, purchasePrice: 90000 });

    await updateProduct(id, { name: "Bot", price: 200000, manufacturerId: m.id, purchasePrice: 95000 }, ctx);
    expect((await getAdminProduct(id))!.purchasePrice).toBe(95000);
    const [log] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "product.update"));
    expect(log!.data).toMatchObject({ changed: ["purchasePrice"], purchasePrice: { from: 90000, to: 95000 } });

    // Vitrin: yayındaki ürünün verisinde maliyet ya da üretici yok
    await db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, id));
    const pub = await getProductBySlug(slug);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("95000");
    expect(json).not.toContain(m.id);
    expect(json).not.toMatch(/purchase|manufacturer|production/i);
  });

  test("pasif üretici yeni ürüne seçilemez", async () => {
    const m = await createManufacturer({ name: "Kapanan", active: false }, ctx);
    await expect(createProduct({ name: "Bot", price: 200000, manufacturerId: m.id }, ctx)).rejects.toMatchObject({ field: "manufacturerId" });
  });
});

describe("alış ve iade fişleri", () => {
  test("alış stoğu artırır, borç yazar, boş alış fiyatını doldurur; iade stoğu düşer ve borcu azaltır", async () => {
    const m = await createManufacturer({ name: "Atölye", openingBalance: 100000 }, ctx);
    const { product, variants } = await supplied(m.id, null);
    const [v40, v41] = variants;

    const catalog = await purchaseCatalog(m.id);
    expect(catalog[0]!.colors[0]!.variants.map((v) => v.size)).toEqual(["40", "41"]);

    const p = await createPurchase(
      {
        kind: "purchase",
        manufacturerId: m.id,
        date: today,
        lines: [
          { variantId: v40!.id, quantity: 10, unitCost: 80000 },
          { variantId: v41!.id, quantity: 5, unitCost: 80000 },
        ],
      },
      ctx,
    );
    expect(await stockOf(v40!.id)).toBe(10);
    expect(await stockOf(v41!.id)).toBe(5);
    const detail = await getPurchase(p.id);
    expect(detail).toMatchObject({ total: 1200000, kind: "purchase" });
    expect(detail!.items[0]!.productionBarcode).toBe(v40!.productionBarcode);
    const [supply] = await db.select().from(schema.productSupply).where(eq(schema.productSupply.productId, product.id));
    expect(supply!.purchasePrice).toBe(80000);

    await createPurchase({ kind: "return", manufacturerId: m.id, date: today, lines: [{ variantId: v40!.id, quantity: 2, unitCost: 80000 }] }, ctx);
    expect(await stockOf(v40!.id)).toBe(8);
    await expect(
      createPurchase({ kind: "return", manufacturerId: m.id, date: today, lines: [{ variantId: v41!.id, quantity: 6, unitCost: 80000 }] }, ctx),
    ).rejects.toMatchObject({ field: "lines" });
    expect(await stockOf(v41!.id)).toBe(5);

    await createLedgerEntry({ kind: "expense", category: "manufacturer_payment", date: today, amount: 300000, method: "bank", manufacturerId: m.id }, ctx);
    const [b] = await manufacturerBalances(m.id);
    // 1.000 devir + 12.000 alış − 1.600 iade − 3.000 ödeme
    expect(b).toMatchObject({ purchased: 1200000, returned: 160000, paid: 300000, balance: 840000 });

    const statement = await manufacturerStatement(m.id);
    expect(statement.map((r) => r.amount)).toEqual([100000, 1200000, -160000, -300000]);
    expect(statement.at(-1)!.balance).toBe(840000);

    const movements = await db.select().from(schema.stockMovements).where(eq(schema.stockMovements.variantId, v40!.id));
    expect(movements.map((mv) => [mv.reason, mv.delta])).toEqual([
      ["purchase", 10],
      ["supplier_return", -2],
    ]);
  });

  test("başka üreticinin ürünü, tekrarlanan numara ve ileri tarih reddedilir", async () => {
    const a = await createManufacturer({ name: "A" }, ctx);
    const b = await createManufacturer({ name: "B" }, ctx);
    const { variants } = await supplied(b.id, 1000);
    const line = { variantId: variants[0]!.id, quantity: 1, unitCost: 1000 };
    await expect(createPurchase({ kind: "purchase", manufacturerId: a.id, date: today, lines: [line] }, ctx)).rejects.toMatchObject({ field: "lines" });
    await expect(createPurchase({ kind: "purchase", manufacturerId: b.id, date: today, lines: [line, line] }, ctx)).rejects.toMatchObject({ field: "lines" });
    await expect(createPurchase({ kind: "purchase", manufacturerId: b.id, date: "2999-01-01", lines: [line] }, ctx)).rejects.toMatchObject({ field: "date" });
    await expect(createPurchase({ kind: "purchase", manufacturerId: b.id, date: "2026-02-30", lines: [line] }, ctx)).rejects.toMatchObject({ field: "date" });
    expect(await db.select().from(schema.purchases)).toHaveLength(0);
  });
});

describe("gelir-gider", () => {
  test("kategori türe uymalı; üretici yalnızca üretici kategorilerinde; silme günlüğe yazılır", async () => {
    const m = await createManufacturer({ name: "A" }, ctx);
    await expect(createLedgerEntry({ kind: "income", category: "rent", date: today, amount: 100, method: "cash" }, ctx)).rejects.toMatchObject({ field: "category" });
    await expect(createLedgerEntry({ kind: "expense", category: "manufacturer_payment", date: today, amount: 100, method: "cash" }, ctx)).rejects.toMatchObject({ field: "manufacturerId" });
    await expect(createLedgerEntry({ kind: "expense", category: "rent", date: today, amount: 100, method: "cash", manufacturerId: m.id }, ctx)).rejects.toMatchObject({ field: "manufacturerId" });
    const { id } = await createLedgerEntry({ kind: "expense", category: "rent", date: today, amount: 100, method: "cash" }, ctx);
    await deleteLedgerEntry(id, ctx);
    expect(await db.select().from(schema.ledgerEntries)).toHaveLength(0);
    const [log] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "ledger.delete"));
    expect(log!.data).toMatchObject({ amount: 100, category: "rent" });
  });
});

describe("satış maliyeti ve özet", () => {
  test("sipariş anındaki maliyet saklanır; sonradan alış fiyatı değişse de özet değişmez", async () => {
    const m = await createManufacturer({ name: "Atölye" }, ctx);
    const { product, variants } = await supplied(m.id, 60000, [{ size: "40", stock: 5 }]);
    const order = await orderFor({ guestToken: "misafir-1" }, variants[0]!.id, 2);
    const [cost] = await db.select().from(schema.orderItemCosts);
    expect(cost).toMatchObject({ manufacturerId: m.id, unitCost: 60000 });

    // Ödenmemiş sipariş satış sayılmaz
    const { from, to } = monthRange();
    expect((await accountingSummary(from, to)).siteOrders).toBe(0);
    await markPaid(order.id);
    await writeProductSupply(product.id, { manufacturerId: m.id, purchasePrice: 99999 }, db);

    await createLedgerEntry({ kind: "expense", category: "shipping", date: today, amount: 5000, method: "card" }, ctx);
    await createLedgerEntry({ kind: "expense", category: "manufacturer_payment", date: today, amount: 50000, method: "bank", manufacturerId: m.id }, ctx);
    await createLedgerEntry({ kind: "income", category: "trendyol", date: today, amount: 20000, method: "bank" }, ctx);

    const s = await accountingSummary(from, to);
    expect(s).toMatchObject({
      siteOrders: 1,
      sitePairs: 2,
      siteRevenue: 300000,
      siteCost: 120000,
      otherIncome: 20000,
      expenses: 5000,
      manufacturerPayments: 50000,
      pairsWithoutCost: 0,
    });
    expect(s.grossProfit).toBe(300000 + s.shippingRevenue + 20000 - 120000);
    expect(s.net).toBe(s.grossProfit - 5000);

    const [b] = await manufacturerBalances(m.id);
    // Satışa göre: 2 × 600 − 500 ödeme
    expect(b).toMatchObject({ soldCost: 120000, dueBySales: 70000, balance: -50000 });

    const rows = await manufacturerProducts(m.id);
    expect(rows[0]).toMatchObject({ soldSite: 2, stock: 3, purchasePrice: 99999 });

    // İade edilen sipariş satıştan çıkar
    await db.update(schema.orders).set({ status: "refunded" }).where(eq(schema.orders.id, order.id));
    expect((await accountingSummary(from, to)).siteRevenue).toBe(0);
  });

  test("Trendyol satışı güncel alış fiyatıyla maliyete girer; maliyeti olmayan satış sayılır", async () => {
    const m = await createManufacturer({ name: "Atölye" }, ctx);
    const { variants } = await supplied(m.id, 40000, [{ size: "40", stock: 5 }]);
    const { variants: noCost } = await makeProduct({ sizes: [{ size: "41", stock: 5 }] });
    await db.insert(schema.trendyolPackages).values({ id: "p1", orderNumber: "T1", status: "Delivered", lines: [], orderDate: new Date() });
    await db.insert(schema.trendyolOrderStock).values([
      { orderNumber: "T1", barcode: "a", variantId: variants[0]!.id, quantity: 3, deducted: 3 },
      { orderNumber: "T1", barcode: "b", variantId: noCost[0]!.id, quantity: 1, deducted: 1 },
    ]);
    const { from, to } = monthRange();
    const s = await accountingSummary(from, to);
    expect(s).toMatchObject({ trendyolPairs: 4, trendyolCost: 120000, pairsWithoutCost: 1 });
    const [b] = await manufacturerBalances(m.id);
    expect(b!.soldCost).toBe(120000);
  });

  test("stok değeri ve eksik bilgi sayıları", async () => {
    const m = await createManufacturer({ name: "Atölye" }, ctx);
    await supplied(m.id, 10000, [{ size: "40", stock: 4 }]);
    await makeProduct({ sizes: [{ size: "41", stock: 2 }] });
    expect(await inventoryValue()).toEqual({ value: 40000, pairs: 6, productsWithoutCost: 1, productsWithoutManufacturer: 1 });
  });
});

describe("dönem", () => {
  test("ay aralığı", () => {
    expect(monthRange("2026-02")).toEqual({ month: "2026-02", from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02").to).toBe("2028-02-29");
    expect(monthRange("bozuk").month).toBe(today.slice(0, 7));
  });

  test("ekstre sırası tarihe göre", async () => {
    const m = await createManufacturer({ name: "Atölye" }, ctx);
    await createLedgerEntry({ kind: "expense", category: "manufacturer_payment", date: today, amount: 100, method: "bank", manufacturerId: m.id }, ctx);
    await createLedgerEntry({ kind: "expense", category: "manufacturer_payment", date: "2026-01-05", amount: 200, method: "bank", manufacturerId: m.id }, ctx);
    const rows = await manufacturerStatement(m.id);
    expect(rows.slice(1).map((r) => r.amount)).toEqual([-200, -100]);
  });
});

describe("dışa aktarma", () => {
  test("dönemdeki gelir-gider ve fiş satırları", async () => {
    const { ledgerForExport, purchaseLinesForExport } = await import("@/server/services/admin/accounting");
    const m = await createManufacturer({ name: "Atölye" }, ctx);
    const { variants } = await supplied(m.id, 1000);
    await createPurchase({ kind: "purchase", manufacturerId: m.id, date: today, lines: [{ variantId: variants[0]!.id, quantity: 2, unitCost: 1000 }] }, ctx);
    await createLedgerEntry({ kind: "expense", category: "rent", date: today, amount: 500, method: "cash", description: "=kira" }, ctx);
    await createLedgerEntry({ kind: "expense", category: "rent", date: "2026-01-01", amount: 700, method: "cash" }, ctx);
    const { from, to } = monthRange();
    const ledger = await ledgerForExport(from, to);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ amount: 500, category: "rent", description: "=kira" });
    const lines = await purchaseLinesForExport(from, to);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ quantity: 2, unit_cost: 1000, manufacturer: "Atölye", production_barcode: variants[0]!.productionBarcode });
  });
});

describe("inceleme düzeltmeleri", () => {
  test("aynı form kimliğiyle ikinci gönderim yeni fiş açmaz", async () => {
    const m = await createManufacturer({ name: "Atölye" }, ctx);
    const { variants } = await supplied(m.id, 1000);
    const input = {
      kind: "purchase" as const,
      manufacturerId: m.id,
      date: today,
      requestId: "7d3c6f0e-8a52-4f8e-9b41-2c0d5b7a1e93",
      lines: [{ variantId: variants[0]!.id, quantity: 4, unitCost: 1000 }],
    };
    const [a, b] = await Promise.all([createPurchase(input, ctx), createPurchase(input, ctx)]);
    const c = await createPurchase(input, ctx);
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(await stockOf(variants[0]!.id)).toBe(4);
  });

  test("alış fişi olan ürünün üreticisi değiştirilemez", async () => {
    const a = await createManufacturer({ name: "A" }, ctx);
    const b = await createManufacturer({ name: "B" }, ctx);
    const { id } = await createProduct({ name: "Bot", price: 200000, manufacturerId: a.id, purchasePrice: 1000 }, ctx);
    await updateProduct(id, { name: "Bot", price: 200000, manufacturerId: b.id, purchasePrice: 1000 }, ctx);
    const [color] = await db.insert(schema.productColors).values({ productId: id, name: "Siyah" }).returning();
    const [v] = await db.insert(schema.variants).values({ colorId: color!.id, size: "40", sku: "X-40" }).returning();
    await createPurchase({ kind: "purchase", manufacturerId: b.id, date: today, lines: [{ variantId: v!.id, quantity: 1, unitCost: 1000 }] }, ctx);
    await expect(updateProduct(id, { name: "Bot", price: 200000, manufacturerId: a.id, purchasePrice: 1000 }, ctx)).rejects.toMatchObject({ field: "manufacturerId" });
    await expect(updateProduct(id, { name: "Bot", price: 200000, manufacturerId: null, purchasePrice: 1000 }, ctx)).rejects.toMatchObject({ field: "manufacturerId" });
    // Alış fiyatı değişebilir
    await updateProduct(id, { name: "Bot", price: 200000, manufacturerId: b.id, purchasePrice: 1200 }, ctx);
  });

  test("Trendyol satırında sabitlenen maliyet, güncel alış fiyatından önce gelir", async () => {
    const m = await createManufacturer({ name: "Atölye" }, ctx);
    const { variants } = await supplied(m.id, 99999, [{ size: "40", stock: 5 }]);
    await db.insert(schema.trendyolPackages).values({ id: "p1", orderNumber: "T1", status: "Delivered", lines: [], orderDate: new Date() });
    await db.insert(schema.trendyolOrderStock).values({
      orderNumber: "T1",
      barcode: "a",
      variantId: variants[0]!.id,
      quantity: 2,
      deducted: 2,
      unitCost: 30000,
      manufacturerId: m.id,
      costFixedAt: new Date(),
    });
    const { from, to } = monthRange();
    expect((await accountingSummary(from, to)).trendyolCost).toBe(60000);
  });
});
