import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import type { MarketplaceLine } from "@/server/db/schema";
import type { N11Package, N11TaskResult } from "@/server/marketplaces/n11/client";
import { getN11Status, runN11Sync, type N11SyncApi } from "@/server/services/marketplace-sync";
import { setPhysicalCount } from "@/server/services/stock";
import { makeProduct, resetDb } from "../helpers/db";

beforeEach(resetDb);

class FakeN11 implements N11SyncApi {
  packages: N11Package[] = [];
  approved: string[][] = [];
  pushes: { stockCode: string; quantity?: number; price?: number }[][] = [];
  tasks = new Map<string, { status: string; skus: { stockCode: string; ok: boolean; reasons: string[] }[] }>();
  seq = 500;
  async shipmentPackages(input: { status: string; page: number }) {
    return { packages: this.packages.filter((p) => p.status === input.status), skipped: 0, totalPages: 1 };
  }
  async approveLines(ids: string[]) {
    this.approved.push(ids);
    return ids.map((lineId) => ({ lineId, ok: true, reason: "ok" }));
  }
  async updatePriceStock(items: { stockCode: string; quantity?: number; price?: number }[]): Promise<N11TaskResult> {
    this.pushes.push(items);
    return { taskId: String(++this.seq), status: "IN_QUEUE", reasons: [] };
  }
  async taskDetails(taskId: string) {
    return this.tasks.get(taskId) ?? { status: "IN_QUEUE", skus: [] };
  }
}

let fake: FakeN11;
let clock: number;
beforeEach(() => {
  fake = new FakeN11();
  clock = Date.parse("2026-11-08T10:00:00Z");
});
const run = (advance = 2 * 60_000) => {
  clock += advance;
  return runN11Sync({ client: fake, now: () => new Date(clock) });
};

let lineSeq = 1;
function pkg(orderNumber: string, status: string, lines: Omit<MarketplaceLine, "lineId" | "status">[], id = `P-${orderNumber}`): N11Package {
  return {
    id,
    orderNumber,
    status,
    orderDate: new Date(clock),
    lastModifiedAt: new Date(clock),
    lines: lines.map((l) => ({ ...l, lineId: String(lineSeq++), status })),
  };
}

async function listed(stock: number, opts: { status?: "active" | "pending"; price?: number } = {}) {
  const { product, variants } = await makeProduct({ name: "Bot", price: opts.price ?? 100000, sizes: [{ size: "38", stock }] });
  const v = variants[0]!;
  await db.insert(schema.marketplaceListings).values({
    channel: "n11",
    variantId: v.id,
    stockCode: v.sku,
    productId: product.id,
    status: opts.status ?? "active",
    pushedQuantity: stock,
    pushedPrice: 133000,
    pushedAt: new Date(clock),
  });
  return { product, v };
}
const stockOf = async (id: string) => (await db.select().from(schema.variants).where(eq(schema.variants.id, id)))[0]!.stock;
const notes = () => db.select().from(schema.notifications);

test("ilk çalıştırma temel çizgi: eski sipariş stoğu değiştirmez, bildirim yok", async () => {
  const { v } = await listed(5);
  fake.packages = [pkg("N1", "Picking", [{ stockCode: v.sku, quantity: 2 }])];
  expect((await run())?.baseline).toBe(true);
  expect(await stockOf(v.id)).toBe(5);
  expect(await notes()).toHaveLength(0);
});

test("yeni sipariş düşer, bildirilir, Created satırları onaylanır; ikinci okuma tekrar düşmez", async () => {
  const { v } = await listed(5);
  await run();
  const p = pkg("N2", "Created", [{ stockCode: v.sku, quantity: 2 }]);
  fake.packages = [p];
  expect((await run())?.deducted).toBe(2);
  expect(await stockOf(v.id)).toBe(3);
  expect(fake.approved).toEqual([[p.lines[0]!.lineId]]);
  const n = (await notes()).find((x) => x.kind === "order_new");
  expect(n).toMatchObject({ source: "n11", dedupeKey: "n11:order:N2", title: "N11 siparişi N2", body: "2 ürün" });
  const mv = await db.select().from(schema.stockMovements);
  expect(mv).toMatchObject([{ delta: -2, reason: "n11", reference: "N11 N2" }]);

  fake.packages = [{ ...p, status: "Picking", lastModifiedAt: new Date(clock + 1000) }];
  await run();
  expect(await stockOf(v.id)).toBe(3);
  expect(fake.approved).toHaveLength(1);
});

test("iptal stoğu geri koyar", async () => {
  const { v } = await listed(5);
  await run();
  const p = pkg("N3", "Created", [{ stockCode: v.sku, quantity: 2 }]);
  fake.packages = [p];
  await run();
  fake.packages = [{ ...p, status: "Cancelled", lastModifiedAt: new Date(clock + 1000) }];
  expect((await run())?.returned).toBe(2);
  expect(await stockOf(v.id)).toBe(5);
});

test("bölünen paket (UnPacked aslı + yeni paketler) bir kez düşer", async () => {
  const { v } = await listed(5);
  await run();
  fake.packages = [pkg("N4", "Picking", [{ stockCode: v.sku, quantity: 2 }], "A")];
  await run();
  fake.packages = [
    { ...pkg("N4", "UnPacked", [{ stockCode: v.sku, quantity: 2 }], "A"), lastModifiedAt: new Date(clock + 5000) },
    pkg("N4", "Picking", [{ stockCode: v.sku, quantity: 1 }], "B"),
    pkg("N4", "Picking", [{ stockCode: v.sku, quantity: 1 }], "C"),
  ];
  await run();
  expect(await stockOf(v.id)).toBe(3);
});

test("stok yetmezse eksik kaydedilir, onaylanmaz, bildirimde yazar", async () => {
  const { v } = await listed(1);
  await run();
  fake.packages = [pkg("N5", "Created", [{ stockCode: v.sku, quantity: 2 }])];
  expect((await run())?.shortfall).toBe(1);
  expect(await stockOf(v.id)).toBe(0);
  expect(fake.approved).toHaveLength(0);
  expect((await notes()).find((x) => x.kind === "order_new")?.body).toBe("2 ürün · 1 adet için sitede stok yoktu");
  expect((await getN11Status()).shortfalls).toMatchObject([{ orderNumber: "N5", shortfall: 1 }]);
});

test("eşleşmeyen stok kodu durumda listelenir", async () => {
  await run();
  fake.packages = [pkg("N6", "Created", [{ stockCode: "YOK-1", quantity: 1 }])];
  await run();
  expect((await getN11Status()).unmatched).toMatchObject([{ orderNumber: "N6", stockCode: "YOK-1", quantity: 1 }]);
  expect(fake.approved).toHaveLength(0);
});

test("ürün yükleme görevi sonucu: başarılı aktif, başarısız neden", async () => {
  const a = await listed(2, { status: "pending" });
  const b = await listed(2, { status: "pending" });
  await db.update(schema.marketplaceListings).set({ taskId: "77" });
  await db.insert(schema.marketplaceTasks).values({ channel: "n11", taskId: "77", kind: "create", createdAt: new Date(clock - 120_000) });
  fake.tasks.set("77", {
    status: "PROCESSED",
    skus: [
      { stockCode: a.v.sku, ok: true, reasons: [] },
      { stockCode: b.v.sku, ok: false, reasons: ["Kategori hatalı"] },
    ],
  });
  await run();
  const rows = await db.select().from(schema.marketplaceListings);
  expect(rows.find((r) => r.stockCode === a.v.sku)).toMatchObject({ status: "active", error: null });
  expect(rows.find((r) => r.stockCode === b.v.sku)).toMatchObject({ status: "failed", error: "Kategori hatalı" });
  expect((await db.select().from(schema.marketplaceTasks))[0]!.done).toBe(true);
});

test("stok ya da fiyat değişince gönderilir, değişmeyince gönderilmez; arşivlenen ürüne 0", async () => {
  const { product, v } = await listed(5);
  await run();
  expect(fake.pushes).toHaveLength(0);
  await db.update(schema.variants).set({ stock: 4 }).where(eq(schema.variants.id, v.id));
  await run();
  expect(fake.pushes.at(-1)).toEqual([{ stockCode: v.sku, quantity: 4, price: 133000 }]);
  await run();
  expect(fake.pushes).toHaveLength(1);
  await db.update(schema.products).set({ status: "archived" }).where(eq(schema.products.id, product.id));
  await run();
  expect(fake.pushes.at(-1)).toEqual([{ stockCode: v.sku, quantity: 0, price: 133000 }]);
});

test("silinen numaranın stok koduna 0 gönderilir", async () => {
  const { v } = await listed(5);
  await db.delete(schema.variants).where(eq(schema.variants.id, v.id));
  await run();
  expect(fake.pushes.at(-1)).toEqual([{ stockCode: v.sku, quantity: 0 }]);
});

test("depo sayımı N11'de kargolanmamış adedi ayrılmış sayar", async () => {
  const { v } = await listed(5);
  await run();
  fake.packages = [pkg("N7", "Picking", [{ stockCode: v.sku, quantity: 2 }])];
  await run();
  const r = await db.transaction((tx) => setPhysicalCount(tx, v.id, 5, { reason: "manual" }));
  expect(r).toMatchObject({ available: 3, reserved: 2 });
});

test("aynı anda iki çalıştırmadan biri atlanır", async () => {
  await listed(1);
  const [a, b] = await Promise.all([run(), run(0)]);
  expect([a, b].filter((x) => x === null)).toHaveLength(1);
});
