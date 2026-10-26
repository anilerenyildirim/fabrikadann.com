import { beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getSyncState, getTrendyolStatus, runTrendyolSync } from "@/server/services/trendyol";
import { reservedByVariant, returnStock } from "@/server/services/stock";
import { TrendyolClient, TrendyolError, trendyolConfig } from "@/server/trendyol/client";
import { makeProduct, resetDb } from "../helpers/db";

beforeEach(resetDb);

type RawLine = { barcode: string; quantity: number; orderLineItemStatusName?: string };
type RawPackage = { id: number; orderNumber: string; status: string; lastModifiedDate?: number; lines: RawLine[] };

/** Trendyol API'sinin bellekteki taklidi: gerçek istemci bu fetch ile konuşur. */
class FakeTrendyol {
  packages: RawPackage[] = [];
  posts: { items: { barcode: string; quantity: number }[] }[] = [];
  batchItems = new Map<string, { barcode: string; status: string; reasons?: string[] }[]>();
  requests: { url: string; init: RequestInit }[] = [];
  failStream = false;
  pageSize = 200;

  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    this.requests.push({ url, init });
    const u = new URL(url);
    if (u.pathname.endsWith("/orders/stream")) {
      if (this.failStream) return new Response(JSON.stringify({ errors: [{ message: "sunucu hatası" }] }), { status: 500 });
      const offset = Number(u.searchParams.get("nextCursor") ?? 0);
      const page = this.packages.slice(offset, offset + this.pageSize);
      const hasMore = offset + this.pageSize < this.packages.length;
      return Response.json({ content: page, hasMore, nextCursor: hasMore ? String(offset + this.pageSize) : null, size: page.length });
    }
    if (u.pathname.endsWith("/price-and-inventory")) {
      const body = JSON.parse(String(init.body));
      this.posts.push(body);
      const id = `batch-${this.posts.length}`;
      this.batchItems.set(
        id,
        body.items.map((i: { barcode: string }) => ({ barcode: i.barcode, status: "SUCCESS" })),
      );
      return Response.json({ batchRequestId: id });
    }
    const batch = u.pathname.match(/batch-requests\/(.+)$/);
    if (batch) {
      const items = this.batchItems.get(decodeURIComponent(batch[1]!)) ?? [];
      return Response.json({
        items: items.map((i) => ({ requestItem: { barcode: i.barcode }, status: i.status, failureReasons: i.reasons ?? [] })),
        batchRequestType: "ProductInventoryUpdate",
      });
    }
    return new Response("bulunamadı", { status: 404 });
  };
}

const cfg = { sellerId: "12345", apiKey: "anahtar", apiSecret: "gizli", baseUrl: "https://apigw.trendyol.com" };

let fake: FakeTrendyol;
let clock: number;
beforeEach(() => {
  fake = new FakeTrendyol();
  clock = Date.parse("2026-10-27T10:00:00Z");
});

const run = (advanceMs = 5 * 60_000) => {
  clock += advanceMs;
  return runTrendyolSync({ client: new TrendyolClient(cfg, fake.fetch), now: () => new Date(clock), pause: async () => {} });
};

async function variantWithBarcode(stock: number, barcode = "8680000000001") {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock }] });
  const v = variants[0]!;
  await db.update(schema.variants).set({ barcode }).where(eq(schema.variants.id, v.id));
  return v.id;
}

const stockOf = async (id: string) => (await db.select().from(schema.variants).where(eq(schema.variants.id, id)))[0]!.stock;

let pkgSeq = 1000;
function pkg(orderNumber: string, status: string, lines: RawLine[], id = ++pkgSeq): RawPackage {
  return { id, orderNumber, status, lastModifiedDate: clock, lines };
}

describe("istemci", () => {
  test("ortam değişkenleri: hiçbiri yoksa kapalı, eksikse ya da hatalıysa hata", () => {
    expect(trendyolConfig({})).toBeNull();
    expect(() => trendyolConfig({ TRENDYOL_API_KEY: "a" })).toThrow(TrendyolError);
    expect(() => trendyolConfig({ TRENDYOL_SELLER_ID: "abc", TRENDYOL_API_KEY: "a", TRENDYOL_API_SECRET: "b" })).toThrow(/rakam/);
    expect(() =>
      trendyolConfig({ TRENDYOL_SELLER_ID: "1", TRENDYOL_API_KEY: "a", TRENDYOL_API_SECRET: "b", TRENDYOL_ENV: "https://kotu.example" }),
    ).toThrow(/prod ya da stage/);
    expect(trendyolConfig({ TRENDYOL_SELLER_ID: "1", TRENDYOL_API_KEY: "a", TRENDYOL_API_SECRET: "b", TRENDYOL_ENV: "stage" })?.baseUrl).toBe(
      "https://stageapigw.trendyol.com",
    );
  });

  test("Basic kimlik ve SelfIntegration User-Agent gönderir", async () => {
    await run();
    const { init, url } = fake.requests[0]!;
    const headers = init.headers as Record<string, string>;
    expect(url.startsWith("https://apigw.trendyol.com/integration/order/sellers/12345/orders/stream?")).toBe(true);
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("anahtar:gizli").toString("base64")}`);
    expect(headers["User-Agent"]).toBe("12345 - SelfIntegration");
  });

  test("hata yanıtında sırrı değil Trendyol mesajını taşır", async () => {
    const client = new TrendyolClient(cfg, async () => new Response(JSON.stringify({ errors: [{ message: "Yetkisiz" }] }), { status: 401 }));
    const err = await client.updateInventory([{ barcode: "1", quantity: 1 }]).catch((e) => e);
    expect(err).toBeInstanceOf(TrendyolError);
    expect(err.status).toBe(401);
    expect(err.message).toContain("Yetkisiz");
    expect(err.message).not.toContain("gizli");
  });
});

describe("senkron", () => {
  test("ilk çalıştırma eski siparişleri stok değiştirmeden kaydeder, stoğu Trendyol'a gönderir", async () => {
    const id = await variantWithBarcode(5);
    fake.packages = [pkg("T1", "Created", [{ barcode: "8680000000001", quantity: 2 }])];
    const summary = await run();
    expect(summary?.baseline).toBe(true);
    expect(await stockOf(id)).toBe(5);
    expect(fake.posts).toEqual([{ items: [{ barcode: "8680000000001", quantity: 5 }] }]);
    const [row] = await db.select().from(schema.trendyolOrderStock);
    expect(row).toMatchObject({ orderNumber: "T1", deducted: 2, shortfall: 0, variantId: id });
    expect((await getSyncState()).cursor).toBe(clock);
  });

  test("yeni Trendyol siparişi stoktan bir kez düşülür; iptal edilince geri konur", async () => {
    const id = await variantWithBarcode(5);
    await run();
    fake.packages = [pkg("T2", "Created", [{ barcode: "8680000000001", quantity: 2 }], 1)];
    expect((await run())?.deducted).toBe(2);
    expect(await stockOf(id)).toBe(3);
    await run();
    expect(await stockOf(id)).toBe(3);
    const movements = await db.select().from(schema.stockMovements);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ delta: -2, reason: "trendyol", reference: "Trendyol T2" });
    // Değişen stok Trendyol'a gönderildi
    expect(fake.posts.at(-1)).toEqual({ items: [{ barcode: "8680000000001", quantity: 3 }] });

    fake.packages = [pkg("T2", "Cancelled", [{ barcode: "8680000000001", quantity: 2, orderLineItemStatusName: "Cancelled" }], 1)];
    expect((await run())?.returned).toBe(2);
    expect(await stockOf(id)).toBe(5);
  });

  test("kalem bazında kısmi iptal yalnızca iptal edilen adedi geri koyar", async () => {
    const id = await variantWithBarcode(5);
    await run();
    fake.packages = [
      pkg("T3", "Created", [
        { barcode: "8680000000001", quantity: 1 },
        { barcode: "8680000000001", quantity: 1 },
      ], 7),
    ];
    await run();
    expect(await stockOf(id)).toBe(3);
    fake.packages = [
      pkg("T3", "Picking", [
        { barcode: "8680000000001", quantity: 1 },
        { barcode: "8680000000001", quantity: 1, orderLineItemStatusName: "Cancelled" },
      ], 7),
    ];
    await run();
    expect(await stockOf(id)).toBe(4);
  });

  test("bölünen paket iki kez düşülmez", async () => {
    const id = await variantWithBarcode(5);
    await run();
    fake.packages = [pkg("T4", "Created", [{ barcode: "8680000000001", quantity: 2 }], 10)];
    await run();
    expect(await stockOf(id)).toBe(3);
    fake.packages = [
      pkg("T4", "UnPacked", [{ barcode: "8680000000001", quantity: 2 }], 10),
      pkg("T4", "Created", [{ barcode: "8680000000001", quantity: 1 }], 11),
      pkg("T4", "Created", [{ barcode: "8680000000001", quantity: 1 }], 12),
    ];
    await run();
    expect(await stockOf(id)).toBe(3);
  });

  test("eski tarihli paket bilgisi yenisinin üzerine yazılmaz", async () => {
    const id = await variantWithBarcode(5);
    await run();
    fake.packages = [pkg("T5", "Cancelled", [{ barcode: "8680000000001", quantity: 1 }], 20)];
    await run();
    const stale = pkg("T5", "Created", [{ barcode: "8680000000001", quantity: 1 }], 20);
    stale.lastModifiedDate = clock - 3600_000;
    fake.packages = [stale];
    await run();
    expect(await stockOf(id)).toBe(5);
  });

  test("stok yetmezse eksik kaydedilir; stok gelince düşülür", async () => {
    const id = await variantWithBarcode(1);
    await run();
    fake.packages = [pkg("T6", "Created", [{ barcode: "8680000000001", quantity: 2 }], 30)];
    expect((await run())?.shortfall).toBe(1);
    expect(await stockOf(id)).toBe(0);
    let status = await getTrendyolStatus();
    expect(status.shortfalls).toMatchObject([{ orderNumber: "T6", shortfall: 1 }]);

    // ör. sitedeki sipariş iptal edildi ve çift stoğa döndü
    await db.transaction((tx) => returnStock(tx, id, 1, { reason: "cancel" }));
    fake.packages = [];
    await run();
    expect(await stockOf(id)).toBe(0);
    status = await getTrendyolStatus();
    expect(status.shortfalls).toEqual([]);
  });

  test("eşleşmeyen barkod listelenir; barkod numaraya yazılınca düşülür", async () => {
    const id = await variantWithBarcode(5, "BASKA");
    await run();
    fake.packages = [pkg("T7", "Created", [{ barcode: "YENI-1", quantity: 1 }], 40)];
    await run();
    expect((await getTrendyolStatus()).unmatched).toMatchObject([{ orderNumber: "T7", barcode: "YENI-1", quantity: 1 }]);
    await db.update(schema.variants).set({ barcode: "YENI-1" }).where(eq(schema.variants.id, id));
    fake.packages = [];
    await run();
    expect(await stockOf(id)).toBe(4);
    expect((await getTrendyolStatus()).unmatched).toEqual([]);
  });

  test("ilk çalıştırmada eşleşmeyen eski sipariş, barkod sonradan eklenince düşülmez", async () => {
    const id = await variantWithBarcode(5, "BASKA");
    fake.packages = [pkg("T8", "Created", [{ barcode: "ESKI-1", quantity: 1 }], 50)];
    await run();
    await db.update(schema.variants).set({ barcode: "ESKI-1" }).where(eq(schema.variants.id, id));
    await run();
    expect(await stockOf(id)).toBe(5);
  });

  test("yalnızca değişen stok gönderilir; 20.000 üstü sınırlanır; başarısız gönderim bir saat sonra yinelenir", async () => {
    const a = await variantWithBarcode(25000, "A1");
    await variantWithBarcode(3, "B1");
    await run();
    expect(fake.posts[0]!.items).toEqual(
      expect.arrayContaining([
        { barcode: "A1", quantity: 20000 },
        { barcode: "B1", quantity: 3 },
      ]),
    );
    fake.batchItems.set("batch-1", [
      { barcode: "A1", status: "SUCCESS" },
      { barcode: "B1", status: "FAILED", reasons: ["Ürün bulunamadı"] },
    ]);
    await run();
    // Değişiklik yok: yeni gönderim yok; sonuçlar işlendi
    expect(fake.posts).toHaveLength(1);
    const status = await getTrendyolStatus();
    expect(status.failedPushes).toMatchObject([{ barcode: "B1", error: "Ürün bulunamadı" }]);
    expect(status.pendingPushes).toBe(0);

    await db.update(schema.variants).set({ stock: 24000 }).where(eq(schema.variants.id, a));
    await run();
    // A1 için 20.000 zaten gönderilmişti; sınır nedeniyle değişiklik sayılmaz
    expect(fake.posts).toHaveLength(1);

    await run(61 * 60_000);
    expect(fake.posts[1]).toEqual({ items: [{ barcode: "B1", quantity: 3 }] });
  });

  test("çekim başarısızsa imleç ilerlemez ve hata kaydedilir", async () => {
    await variantWithBarcode(5);
    await run();
    const before = (await getSyncState()).cursor;
    fake.failStream = true;
    await expect(run()).rejects.toBeInstanceOf(TrendyolError);
    const state = await getSyncState();
    expect(state.cursor).toBe(before);
    expect(state.lastError).toContain("sunucu hatası");
    fake.failStream = false;
    await run();
    expect((await getSyncState()).lastError).toBeNull();
  });

  test("sayfalı akış: tüm sayfalar işlenir", async () => {
    const id = await variantWithBarcode(50);
    await run();
    fake.pageSize = 2;
    fake.packages = Array.from({ length: 5 }, (_, i) => pkg(`P${i}`, "Created", [{ barcode: "8680000000001", quantity: 1 }], 100 + i));
    await run();
    expect(await stockOf(id)).toBe(45);
  });

  test("aynı anda iki çalıştırmadan biri atlanır", async () => {
    await variantWithBarcode(5);
    const slow = new FakeTrendyol();
    const fetchSlow = async (url: string, init: RequestInit) => {
      await new Promise((r) => setTimeout(r, 100));
      return slow.fetch(url, init);
    };
    const go = () => runTrendyolSync({ client: new TrendyolClient(cfg, fetchSlow), now: () => new Date(clock), pause: async () => {} });
    const results = await Promise.all([go(), go()]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });

  test("kargolanmamış Trendyol siparişi depo sayımında ayrılmış sayılır, kargolanan sayılmaz", async () => {
    const id = await variantWithBarcode(5);
    await run();
    fake.packages = [
      pkg("R1", "Picking", [{ barcode: "8680000000001", quantity: 2 }], 60),
      pkg("R2", "Shipped", [{ barcode: "8680000000001", quantity: 1 }], 61),
    ];
    await run();
    expect(await stockOf(id)).toBe(2);
    expect((await reservedByVariant(db, [id])).get(id)).toBe(2);
    expect((await reservedByVariant(db)).get(id)).toBe(2);
  });
});
