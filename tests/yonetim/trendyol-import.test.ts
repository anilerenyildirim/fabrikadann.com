import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { inventoryValue } from "@/server/services/admin/accounting";
import { buildSku, updateProduct, updateVariant } from "@/server/services/admin/catalog";
import { AdminAccessError, type AdminContext } from "@/server/services/admin/context";
import { importTrendyolProducts, listTrendyolImportCandidates } from "@/server/services/admin/trendyol-import";
import { getSyncState, runTrendyolSync } from "@/server/services/trendyol";
import { TrendyolClient } from "@/server/trendyol/client";
import {
  discountedPrice,
  fetchTrendyolImage,
  groupContents,
  htmlToText,
  ImageFetchError,
  isAllowedImageUrl,
  sizeOf,
} from "@/server/trendyol/products";
import { makeProduct, makeUser, resetDb } from "../helpers/db";

type RawVariant = {
  barcode: string;
  attributes?: { attributeName: string; attributeValue: string }[];
  onSale?: boolean;
  archived?: boolean;
  stock?: { quantity: number };
  price?: { salePrice: number; listPrice?: number };
};
type RawContent = {
  contentId: number;
  productMainId: string;
  title: string;
  description?: string;
  category?: { id: number; name: string };
  brand?: { id: number; name: string };
  images?: { url: string }[];
  attributes?: { attributeName: string; attributeValue?: string; attributeValues?: { attributeValue: string }[] }[];
  variants: RawVariant[];
};

/** Trendyol ürün, sipariş, stok ve fiyat uçlarının bellekteki taklidi. */
class FakeTrendyol {
  contents: RawContent[] = [];
  packages: unknown[] = [];
  posts: { items: { barcode: string; quantity: number }[] }[] = [];
  prices = new Map<string, number>();
  productRequests: string[] = [];
  pageSize = 100;

  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url);
    if (u.pathname.endsWith("/products/approved")) {
      this.productRequests.push(u.search);
      const mainId = u.searchParams.get("productMainId");
      const list = mainId ? this.contents.filter((c) => c.productMainId === mainId) : this.contents;
      const page = Number(u.searchParams.get("page") ?? 0);
      const size = Number(u.searchParams.get("size") ?? 100);
      const slice = list.slice(page * size, page * size + size);
      return Response.json({ content: slice, page, size, totalElements: list.length, totalPages: Math.ceil(list.length / size) });
    }
    if (u.pathname.endsWith("/orders/stream")) {
      return Response.json({ content: this.packages, hasMore: false, nextCursor: null });
    }
    if (u.pathname.endsWith("/price-and-inventory")) {
      this.posts.push(JSON.parse(String(init.body)));
      return Response.json({ batchRequestId: `batch-${this.posts.length}` });
    }
    if (u.pathname.endsWith("/products/approved/inventory-and-price")) {
      const asked = (u.searchParams.get("barcodes") ?? "").split(",");
      const variants = asked.filter((b) => this.prices.has(b)).map((b) => ({ barcode: b, salePrice: this.prices.get(b) }));
      return Response.json({ content: variants.length ? [{ variants }] : [] });
    }
    if (u.pathname.includes("/batch-requests/")) return Response.json({ items: [] });
    return new Response("bulunamadı", { status: 404 });
  };
}

const cfg = { sellerId: "12345", apiKey: "anahtar", apiSecret: "gizli", baseUrl: "https://apigw.trendyol.com" };

let uploadDir: string;
let ctx: AdminContext;
let fake: FakeTrendyol;
let clock: number;
let imageRequests: string[];
let jpeg: Buffer;

beforeAll(async () => {
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "fd-trendyol-aktar-"));
  process.env.UPLOAD_DIR = uploadDir;
  jpeg = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 30, g: 30, b: 30 } } })
    .jpeg()
    .toBuffer();
});

afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb();
  const admin = await makeUser({ role: "admin" });
  ctx = { actorId: admin.id, ip: "10.0.0.1" };
  fake = new FakeTrendyol();
  clock = Date.parse("2026-11-01T10:00:00Z");
  imageRequests = [];
});

const deps = () => ({
  client: new TrendyolClient(cfg, fake.fetch),
  fetchImage: async (url: string) => {
    imageRequests.push(url);
    return jpeg;
  },
  now: () => new Date(clock),
  pause: async () => {},
});

const sync = (advanceMs = 5 * 60_000) => {
  clock += advanceMs;
  return runTrendyolSync({ client: new TrendyolClient(cfg, fake.fetch), now: () => new Date(clock), pause: async () => {} });
};

const beden = (v: string) => [{ attributeName: "Beden", attributeValue: v }];
const renk = (v: string) => [{ attributeName: "Renk", attributeValue: v }];

function sneaker(mainId = "MODEL-1"): RawContent[] {
  return [
    {
      contentId: 1,
      productMainId: mainId,
      title: "Deri Sneaker",
      description: "<p>Hakiki <b>deri</b> &amp; kauçuk taban</p><ul><li>Rahat</li><li>Hafif</li></ul>",
      category: { id: 411, name: "Sneaker" },
      brand: { id: 1, name: "fabrikadann" },
      images: [{ url: "https://cdn.dsmcdn.com/ty1/siyah-1.jpg" }, { url: "https://cdn.dsmcdn.com/ty1/siyah-2.jpg" }],
      attributes: renk("Siyah"),
      variants: [
        { barcode: `${mainId}-S38`, attributes: beden("38"), onSale: true, stock: { quantity: 4 }, price: { salePrice: 1299.99 } },
        { barcode: `${mainId}-S39`, attributes: beden("39"), onSale: true, stock: { quantity: 0 }, price: { salePrice: 1399.99 } },
      ],
    },
    {
      contentId: 2,
      productMainId: mainId,
      title: "Deri Sneaker",
      images: [{ url: "https://cdn.dsmcdn.com/ty1/beyaz-1.jpg" }],
      attributes: renk("Beyaz"),
      variants: [{ barcode: `${mainId}-B40`, attributes: beden("40"), onSale: true, stock: { quantity: 2 }, price: { salePrice: 1299.99 } }],
    },
  ];
}

const productByMainId = async (mainId: string) =>
  db.query.products.findFirst({
    where: eq(schema.products.trendyolMainId, mainId),
    with: { colors: { with: { variants: true, images: true } } },
  });

const variantByBarcode = async (barcode: string) =>
  (await db.select().from(schema.variants).where(eq(schema.variants.barcode, barcode)))[0]!;

// ---------- Saf yardımcılar ----------

describe("yardımcılar", () => {
  test("indirimli fiyat tam liraya yuvarlanır; oran ürün başına değişebilir", () => {
    expect(discountedPrice(129999, 25)).toBe(97500); // 974,99 → 975 TL
    expect(discountedPrice(100000, 25)).toBe(75000);
    expect(discountedPrice(100000, 10)).toBe(90000);
    expect(discountedPrice(100000, 0)).toBe(100000);
    expect(discountedPrice(50, 25)).toBe(100); // en az 1 TL
    expect(() => discountedPrice(100000, 95)).toThrow();
  });

  test("HTML açıklama düz metne çevrilir, etiket ve betik kalmaz", () => {
    const text = htmlToText(
      `<p>Hakiki <b>deri</b> &amp; kauçuk&nbsp;taban</p><script>alert(1)</script><ul><li>Rahat</li><li>Hafif &#246;l&#xE7;&#252;</li></ul><img src=x onerror=alert(1)>Son`,
    );
    expect(text).toBe("Hakiki deri & kauçuk taban\n- Rahat\n- Hafif ölçü\nSon");
    expect(text).not.toMatch(/[<>]/);
    expect(htmlToText("&lt;script&gt;")).toBe("<script>"); // çözülen metin yalnızca düz metin olarak basılır
  });

  test("numara Beden/Numara özelliğinden okunur", () => {
    expect(sizeOf(beden("38,5"))).toBe("38.5");
    expect(sizeOf([{ attributeName: "Numara", attributeValue: " 40 " }])).toBe("40");
    expect(sizeOf(renk("Siyah"))).toBeNull();
  });

  test("productMainId'ye göre gruplar: içerik → renk, numara → beden; sorunlu numaralar ayrılır", () => {
    const contents = sneaker().map((c) => ({
      contentId: String(c.contentId),
      productMainId: c.productMainId,
      title: c.title,
      description: c.description ?? "",
      categoryName: c.category?.name ?? null,
      brandName: null,
      images: (c.images ?? []).map((i) => i.url),
      attributes: (c.attributes ?? []).map((a) => ({ attributeName: a.attributeName, attributeValue: a.attributeValue ?? null })),
      variants: c.variants.map((v) => ({
        barcode: v.barcode,
        attributes: v.attributes ?? [],
        onSale: v.onSale ?? false,
        archived: v.archived ?? false,
        quantity: v.stock?.quantity ?? 0,
        salePrice: v.price ? Math.round(v.price.salePrice * 100) : null,
      })),
    }));
    contents[0]!.variants.push(
      { barcode: "NOSIZE", attributes: [], onSale: true, archived: false, quantity: 1, salePrice: 100000 },
      { barcode: "DUP38", attributes: beden("38"), onSale: true, archived: false, quantity: 1, salePrice: 100000 },
      { barcode: "ARSIV", attributes: beden("41"), onSale: false, archived: true, quantity: 9, salePrice: 1000 },
    );
    contents.push({ ...contents[1]!, productMainId: "BASKA", variants: [{ ...contents[1]!.variants[0]!, barcode: "TEK", attributes: [] }] });

    const groups = groupContents(contents);
    expect(groups.map((g) => g.productMainId)).toEqual(["MODEL-1", "BASKA"]);
    const g = groups[0]!;
    expect(g.colors.map((c) => [c.name, c.items.map((i) => i.size)])).toEqual([
      ["Siyah", ["38", "39"]],
      ["Beyaz", ["40"]],
    ]);
    expect(g.colors[0]!.images).toHaveLength(2);
    expect(g.problems.map((p) => p.barcode)).toEqual(["NOSIZE", "DUP38"]);
    // Satıştaki numaraların en düşüğü (arşivdeki 10 TL sayılmaz); 100000 kuruşluk sorunlu numaralar da sayılmaz
    expect(g.trendyolPrice).toBe(129999);
    expect(g.description).toBe("Hakiki deri & kauçuk taban\n- Rahat\n- Hafif");
    // Tek numaralı içerikte numara yoksa "Standart"
    expect(groups[1]!.colors[0]!.items[0]!.size).toBe("Standart");
  });

  test("görsel yalnızca Trendyol CDN'inden (https) indirilir", async () => {
    expect(isAllowedImageUrl("https://cdn.dsmcdn.com/ty1/a.jpg")).toBe(true);
    for (const bad of [
      "http://cdn.dsmcdn.com/a.jpg",
      "https://dsmcdn.com.evil.example/a.jpg",
      "https://evil.example/cdn.dsmcdn.com/a.jpg",
      "https://user:pw@cdn.dsmcdn.com/a.jpg",
      "https://cdn.dsmcdn.com:8443/a.jpg",
      "https://127.0.0.1/a.jpg",
      "https://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
      "yanlis",
    ]) {
      expect(isAllowedImageUrl(bad), bad).toBe(false);
    }
    const calls: string[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push(url);
      expect(init.redirect).toBe("error");
      return new Response(new Uint8Array(11 * 1024 * 1024));
    };
    await expect(fetchTrendyolImage("https://169.254.169.254/x", fetchImpl)).rejects.toBeInstanceOf(ImageFetchError);
    expect(calls).toEqual([]);
    await expect(fetchTrendyolImage("https://cdn.dsmcdn.com/buyuk.jpg", fetchImpl)).rejects.toThrow(/10 MB/);
    const ok = await fetchTrendyolImage("https://cdn.dsmcdn.com/k.jpg", async () => new Response(new Uint8Array(jpeg)));
    expect(ok.equals(jpeg)).toBe(true);
  });
});

// ---------- Aktarım ----------

describe("aktarım", () => {
  test("yönetici olmayan listeleyemez ve aktaramaz", async () => {
    fake.contents = sneaker();
    const customer = await makeUser();
    const other = { actorId: customer.id };
    await expect(listTrendyolImportCandidates(other, deps())).rejects.toBeInstanceOf(AdminAccessError);
    await expect(importTrendyolProducts(["MODEL-1"], other, deps())).rejects.toBeInstanceOf(AdminAccessError);
    await expect(importTrendyolProducts(["MODEL-1"], { actorId: "yok" }, deps())).rejects.toBeInstanceOf(AdminAccessError);
    expect(await db.select().from(schema.products)).toHaveLength(0);
  });

  test("liste sayfalanır ve siteye göre durum gösterir", async () => {
    fake.contents = [...sneaker("A"), ...sneaker("B")];
    await makeProduct({ sizes: [{ size: "38", stock: 1 }] }).then(({ variants }) =>
      db.update(schema.variants).set({ barcode: "B-S38" }).where(eq(schema.variants.id, variants[0]!.id)),
    );
    const client = new TrendyolClient(cfg, fake.fetch);
    const page = await client.approvedProducts({ page: 0, size: 3 });
    expect(page.contents).toHaveLength(3);
    expect(page.hasMore).toBe(true);

    const { candidates } = await listTrendyolImportCandidates(ctx, deps());
    const a = candidates.find((c) => c.productMainId === "A")!;
    const b = candidates.find((c) => c.productMainId === "B")!;
    expect(a).toMatchObject({ newItems: 3, existingItems: 0, newStock: 6, trendyolPrice: 129999, sitePrice: 97500, siteProduct: null });
    expect(b).toMatchObject({ newItems: 2, existingItems: 1 });
    expect(b.siteProduct).not.toBeNull();
  });

  test("taslak ürün oluşturur: renkler, barkodlar, stok hareketi, görseller, kategori, %25 indirimli fiyat", async () => {
    fake.contents = sneaker();
    const [result] = await importTrendyolProducts(["MODEL-1"], ctx, deps());
    expect(result).toMatchObject({ status: "created", imageErrors: 0 });
    expect(result!.added).toEqual(["Siyah 38", "Siyah 39", "Beyaz 40"]);

    const p = (await productByMainId("MODEL-1"))!;
    expect(p).toMatchObject({
      status: "draft",
      name: "Deri Sneaker",
      price: 97500,
      trendyolPrice: 129999,
      trendyolSalePrice: 129999,
      trendyolDiscount: 25,
      description: "Hakiki deri & kauçuk taban\n- Rahat\n- Hafif",
    });
    const category = await db.query.categories.findFirst({ where: eq(schema.categories.id, p.categoryId!) });
    expect(category?.name).toBe("Sneaker");
    expect(p.colors.map((c) => [c.name, c.images.length, c.variants.length]).sort()).toEqual([
      ["Beyaz", 1, 1],
      ["Siyah", 2, 2],
    ]);
    expect(imageRequests).toHaveLength(3);

    const v38 = await variantByBarcode("MODEL-1-S38");
    expect(v38.stock).toBe(4);
    expect(v38.size).toBe("38");
    expect(v38.productionBarcode).toMatch(/^29\d{11}$/);
    expect(v38.trendyolImportedAt?.getTime()).toBe(clock);
    const moves = await db.select().from(schema.stockMovements).where(eq(schema.stockMovements.variantId, v38.id));
    expect(moves).toMatchObject([{ delta: 4, reason: "initial", actorId: ctx.actorId }]);
    // Stoğu 0 olan numara için hareket yazılmaz
    const v39 = await variantByBarcode("MODEL-1-S39");
    expect(await db.select().from(schema.stockMovements).where(eq(schema.stockMovements.variantId, v39.id))).toHaveLength(0);

    // Üretici zorunlu değil; muhasebe eksik üreticiyi/alış fiyatını sayar
    expect(await db.select().from(schema.productSupply).where(eq(schema.productSupply.productId, p.id))).toHaveLength(0);
    const inv = await inventoryValue();
    expect(inv.productsWithoutManufacturer).toBe(1);
    expect(inv.productsWithoutCost).toBe(1);

    const log = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "product.trendyol_import"));
    expect(log).toHaveLength(1);
  });

  test("aynı adlı kategori yeniden kullanılır", async () => {
    const [existing] = await db.insert(schema.categories).values({ name: "sneaker", slug: "sneaker" }).returning();
    fake.contents = sneaker();
    await importTrendyolProducts(["MODEL-1"], ctx, deps());
    expect((await productByMainId("MODEL-1"))!.categoryId).toBe(existing!.id);
    expect(await db.select().from(schema.categories)).toHaveLength(1);
  });

  test("aktarılmış ürün atlanır; Trendyol'a sonradan eklenen numara mevcut ürüne eklenir", async () => {
    fake.contents = sneaker();
    await importTrendyolProducts(["MODEL-1"], ctx, deps());
    const again = await importTrendyolProducts(["MODEL-1"], ctx, deps());
    expect(again[0]).toMatchObject({ status: "skipped", message: "Tüm numaralar zaten sitede." });
    expect(await db.select().from(schema.products)).toHaveLength(1);

    fake.contents[1]!.variants.push({ barcode: "MODEL-1-B41", attributes: beden("41"), onSale: true, stock: { quantity: 3 }, price: { salePrice: 999 } });
    fake.contents.push({
      contentId: 3,
      productMainId: "MODEL-1",
      title: "Deri Sneaker",
      images: [{ url: "https://cdn.dsmcdn.com/ty1/lacivert.jpg" }],
      attributes: renk("Lacivert"),
      variants: [{ barcode: "MODEL-1-L40", attributes: beden("40"), onSale: true, stock: { quantity: 1 }, price: { salePrice: 1299.99 } }],
    });
    imageRequests = [];
    const [r] = await importTrendyolProducts(["MODEL-1"], ctx, deps());
    expect(r).toMatchObject({ status: "updated", added: ["Beyaz 41", "Lacivert 40"] });
    // Yalnızca yeni renk için görsel indirilir; mevcut ürünün fiyatı değişmez
    expect(imageRequests).toEqual(["https://cdn.dsmcdn.com/ty1/lacivert.jpg"]);
    const p = (await productByMainId("MODEL-1"))!;
    expect(p.price).toBe(97500);
    expect(p.colors).toHaveLength(3);
    expect((await variantByBarcode("MODEL-1-B41")).stock).toBe(3);
  });

  test("elle eklenmiş ürünün barkodu varsa yeni numaralar o ürüne eklenir", async () => {
    const { product, variants } = await makeProduct({ colors: [{ name: "Siyah", sizes: [{ size: "38", stock: 7 }] }] });
    await db.update(schema.variants).set({ barcode: "MODEL-1-S38" }).where(eq(schema.variants.id, variants[0]!.id));
    fake.contents = sneaker();
    const [r] = await importTrendyolProducts(["MODEL-1"], ctx, deps());
    expect(r).toMatchObject({ status: "updated", productId: product.id, added: ["Siyah 39", "Beyaz 40"] });
    expect((await variantByBarcode("MODEL-1-S38")).stock).toBe(7); // mevcut numaranın stoğuna dokunulmaz
    expect((await db.query.products.findFirst({ where: eq(schema.products.id, product.id) }))!.trendyolMainId).toBe("MODEL-1");
  });

  test("barkod çakışmaları raporlanır, çökmez", async () => {
    // Barkodlar iki farklı üründe: hangi ürüne ekleneceği belli değil
    const a = await makeProduct();
    const b = await makeProduct();
    await db.update(schema.variants).set({ barcode: "MODEL-1-S38" }).where(eq(schema.variants.id, a.variants[0]!.id));
    await db.update(schema.variants).set({ barcode: "MODEL-1-S39" }).where(eq(schema.variants.id, b.variants[0]!.id));
    fake.contents = sneaker();
    const [r] = await importTrendyolProducts(["MODEL-1"], ctx, deps());
    expect(r).toMatchObject({ status: "skipped" });
    expect(r!.message).toMatch(/birden fazla üründe/);

    // Aktarılmış ürünün yeni numarasının barkodu başka üründe: numara atlanır, sebebi yazılır
    fake.contents = sneaker("M2");
    await importTrendyolProducts(["M2"], ctx, deps());
    fake.contents[1]!.variants.push({ barcode: "MODEL-1-S38", attributes: beden("41"), onSale: true, stock: { quantity: 1 }, price: { salePrice: 1 } });
    fake.contents[1]!.variants.push({ barcode: "M2-B42", attributes: beden("42"), onSale: true, stock: { quantity: 1 }, price: { salePrice: 1 } });
    const [r2] = await importTrendyolProducts(["M2"], ctx, deps());
    expect(r2).toMatchObject({ status: "updated", added: ["Beyaz 42"] });
    expect(r2!.problems).toEqual([{ barcode: "MODEL-1-S38", reason: expect.stringMatching(/ürününde kayıtlı/) }]);

    // Sitenin barkod biçimine uymayan barkod
    fake.contents = sneaker("M3");
    fake.contents[0]!.variants[0]!.barcode = "M3 S38/x";
    const [r3] = await importTrendyolProducts(["M3"], ctx, deps());
    expect(r3!.problems.map((p) => p.barcode)).toEqual(["M3 S38/x"]);
    expect(r3!.added).toEqual(["Siyah 39", "Beyaz 40"]);
  });

  test("Trendyol'da olmayan ürün ve fiyatı okunamayan ürün atlanır; geçersiz seçim reddedilir", async () => {
    fake.contents = sneaker();
    for (const v of fake.contents.flatMap((c) => c.variants)) delete v.price;
    const res = await importTrendyolProducts(["YOK", "MODEL-1"], ctx, deps());
    expect(res.map((r) => r.status)).toEqual(["skipped", "skipped"]);
    expect(res[1]!.message).toMatch(/fiyatı okunamadı/);
    await expect(importTrendyolProducts([], ctx, deps())).rejects.toThrow(/seçin/);
    await expect(importTrendyolProducts(Array.from({ length: 9 }, (_, i) => `M${i}`), ctx, deps())).rejects.toThrow(/en fazla 8/);
  });

  test("indirilemeyen görsel aktarımı durdurmaz", async () => {
    fake.contents = sneaker();
    const d = { ...deps(), fetchImage: async () => Buffer.from("görsel değil") };
    const [r] = await importTrendyolProducts(["MODEL-1"], ctx, d);
    expect(r).toMatchObject({ status: "created", imageErrors: 3 });
  });
});

// ---------- Ortak stok ve fiyat senkronu ----------

describe("senkronla birlikte", () => {
  test("aktarılan stok Trendyol'a geri gönderilmez; aktarımdan önceki Trendyol siparişi ikinci kez düşülmez", async () => {
    await sync(); // ilk çalıştırma (başlangıç)
    clock += 10 * 60_000;
    // Aktarımdan önce verilmiş, henüz eşleşmemiş sipariş zaten kayıtlı
    fake.packages = [
      { id: 1, orderNumber: "T-ESKI", status: "Created", orderDate: clock - 60_000, lastModifiedDate: clock, lines: [{ barcode: "MODEL-1-S38", quantity: 1 }] },
    ];
    await sync();
    expect(await db.select().from(schema.trendyolOrderStock)).toMatchObject([{ orderNumber: "T-ESKI", variantId: null, deducted: 0 }]);
    fake.contents = sneaker();
    clock += 60_000;
    await importTrendyolProducts(["MODEL-1"], ctx, deps());
    const v = await variantByBarcode("MODEL-1-S38");
    expect(v.stock).toBe(4);

    // Aktarımdan önce verilmiş ama sonra çekilen sipariş, aktarıma çok yakın sipariş ve aktarımdan sonra verilen sipariş.
    // Trendyol saat dilimi farkı (3 sa) yüzünden aktarıma 3 saatten yakın sipariş güvenli tarafta kalıp düşülür.
    fake.packages = [
      { id: 2, orderNumber: "T-ARADA", status: "Created", orderDate: clock - 4 * 3600_000, lastModifiedDate: clock + 60_000, lines: [{ barcode: "MODEL-1-S38", quantity: 1 }] },
      { id: 4, orderNumber: "T-SINIRDA", status: "Created", orderDate: clock - 30_000, lastModifiedDate: clock + 60_000, lines: [{ barcode: "MODEL-1-S38", quantity: 1 }] },
      { id: 3, orderNumber: "T-YENI", status: "Created", orderDate: clock + 60_000, lastModifiedDate: clock + 60_000, lines: [{ barcode: "MODEL-1-S38", quantity: 1 }] },
    ];
    fake.posts = [];
    await sync();
    expect((await variantByBarcode("MODEL-1-S38")).stock).toBe(2); // T-ARADA düşülmedi; T-SINIRDA ve T-YENI düşüldü
    const rows = await db.select().from(schema.trendyolOrderStock);
    expect(rows.every((r) => r.variantId === v.id && r.deducted === r.quantity)).toBe(true);

    // Yalnızca değişen stok gönderilir (aktarılan diğer numaralar Trendyol'da zaten aynı)
    expect(fake.posts.flatMap((p) => p.items)).toEqual([{ barcode: "MODEL-1-S38", quantity: 2 }]);
  });

  test("saatlik fiyat senkronu indirimli ürünün fiyatını Trendyol fiyatından yeniden hesaplar", async () => {
    fake.contents = sneaker();
    await importTrendyolProducts(["MODEL-1"], ctx, deps());
    const manual = await makeProduct({ price: 50000 });
    await db.update(schema.variants).set({ barcode: "ELLE-1" }).where(eq(schema.variants.id, manual.variants[0]!.id));

    fake.prices = new Map([
      ["MODEL-1-S38", 1600],
      ["MODEL-1-S39", 1700],
      ["MODEL-1-B40", 1500],
      ["ELLE-1", 600],
    ]);
    const summary = await sync();
    expect(summary?.pricesUpdated).toBe(2);
    const p = (await productByMainId("MODEL-1"))!;
    expect(p).toMatchObject({ price: 112500, trendyolPrice: 150000, trendyolSalePrice: 150000 });
    // İndirimi olmayan ürünün fiyatı elle kalır, yalnızca karşılaştırma güncellenir
    const m = (await db.query.products.findFirst({ where: eq(schema.products.id, manual.product.id) }))!;
    expect(m).toMatchObject({ price: 50000, trendyolPrice: 60000, trendyolDiscount: null });

    // Yönetici oranı değiştirir: fiyat son okunan Trendyol fiyatından hesaplanır, fiyat alanı yok sayılır
    await updateProduct(
      p.id,
      { name: p.name, price: 1, trendyolPrice: null, trendyolDiscount: 10, status: "draft", manufacturerId: null },
      ctx,
    );
    expect((await productByMainId("MODEL-1"))!).toMatchObject({ price: 135000, trendyolPrice: 150000, trendyolDiscount: 10 });

    // İndirim kaldırılırsa fiyat elle girilir ve sonraki senkron fiyata dokunmaz
    await updateProduct(
      p.id,
      { name: p.name, price: 140000, trendyolPrice: 150000, trendyolDiscount: null, status: "draft", manufacturerId: null },
      ctx,
    );
    fake.prices.set("MODEL-1-B40", 1550);
    await sync(2 * 3600_000);
    expect((await productByMainId("MODEL-1"))!).toMatchObject({ price: 140000, trendyolPrice: 155000, trendyolSalePrice: 155000 });
  });

  test("indirim için Trendyol fiyatı bilinmiyorsa hata verir", async () => {
    const { product } = await makeProduct();
    await expect(
      updateProduct(product.id, { name: "Ürün", price: 100000, trendyolPrice: null, trendyolDiscount: 25, status: "active" }, ctx),
    ).rejects.toThrow(/Trendyol fiyatını yazın/);
  });
});

describe("inceleme düzeltmeleri", () => {
  test("SKU'nun numara kısmı SKU kuralına uyar", () => {
    const id = "abcdef12-0000-0000-0000-000000000000";
    expect(buildSku(id, 0, "40")).toBe("FD-ABCDEF-1-40");
    expect(buildSku(id, 1, "Tek Ebat")).toBe("FD-ABCDEF-2-TEK-EBAT");
    expect(buildSku(id, 0, "38,5")).toBe("FD-ABCDEF-1-38.5");
    expect(buildSku(id, 0, "36/37")).toBe("FD-ABCDEF-1-36-37");
    expect(buildSku(id, 0, "Küçük")).toBe("FD-ABCDEF-1-KUCUK");
  });

  test("Trendyol fiyatı %30'dan fazla değişirse indirimli ürünün fiyatı kendiliğinden değişmez, uyarı çıkar", async () => {
    fake.contents = sneaker();
    await importTrendyolProducts(["MODEL-1"], ctx, deps());
    expect((await productByMainId("MODEL-1"))!.price).toBe(97500);
    fake.prices = new Map([
      ["MODEL-1-S38", 300],
      ["MODEL-1-S39", 300],
      ["MODEL-1-B40", 300],
    ]);
    await sync();
    const p = (await productByMainId("MODEL-1"))!;
    expect(p).toMatchObject({ price: 97500, trendyolSalePrice: 30000 });
    const warnings = (await getSyncState()).priceWarnings ?? [];
    expect(warnings).toMatchObject([{ productId: p.id, kind: "jump", price: 97500, proposedPrice: 22500 }]);
  });

  test("yalnızca son Trendyol fiyatı değişince ürünün güncellenme zamanı değişmez", async () => {
    const manual = await makeProduct({ price: 50000 });
    await db.update(schema.variants).set({ barcode: "ELLE-1" }).where(eq(schema.variants.id, manual.variants[0]!.id));
    const before = (await db.query.products.findFirst({ where: eq(schema.products.id, manual.product.id) }))!;
    fake.prices = new Map([["ELLE-1", 400]]);
    await sync();
    const after = (await db.query.products.findFirst({ where: eq(schema.products.id, manual.product.id) }))!;
    expect(after.trendyolSalePrice).toBe(40000);
    expect(after.price).toBe(50000);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  test("form açıkken senkron Trendyol fiyatını değiştirdiyse kaydetmek eski fiyatı geri yazmaz", async () => {
    fake.contents = sneaker();
    await importTrendyolProducts(["MODEL-1"], ctx, deps());
    const p = (await productByMainId("MODEL-1"))!;
    const shown = p.trendyolSalePrice; // formun açıldığı andaki değer (129999)
    fake.prices = new Map([
      ["MODEL-1-S38", 1500],
      ["MODEL-1-S39", 1500],
      ["MODEL-1-B40", 1500],
    ]);
    await sync();
    await updateProduct(
      p.id,
      { name: "Yeni ad", price: 1, trendyolPrice: shown, trendyolDiscount: 25, status: "draft", manufacturerId: null },
      ctx,
      { trendyolPriceShown: shown },
    );
    expect((await productByMainId("MODEL-1"))!).toMatchObject({ name: "Yeni ad", price: 112500, trendyolSalePrice: 150000 });

    // Alan elle değiştirildiyse yazılan değer esas alınır
    await updateProduct(
      p.id,
      { name: "Yeni ad", price: 1, trendyolPrice: 200000, trendyolDiscount: 25, status: "draft", manufacturerId: null },
      ctx,
      { trendyolPriceShown: 150000 },
    );
    expect((await productByMainId("MODEL-1"))!).toMatchObject({ price: 150000, trendyolSalePrice: 200000 });
  });

  test("barkod değişince Trendyol aktarım zamanı silinir", async () => {
    fake.contents = sneaker();
    await importTrendyolProducts(["MODEL-1"], ctx, deps());
    const v = (await productByMainId("MODEL-1"))!.colors.flatMap((c) => c.variants).find((x) => x.barcode === "MODEL-1-S38")!;
    expect(v.trendyolImportedAt).not.toBeNull();
    await updateVariant(v.id, { sku: v.sku, barcode: "MODEL-1-S38" }, ctx);
    expect((await db.query.variants.findFirst({ where: eq(schema.variants.id, v.id) }))!.trendyolImportedAt).not.toBeNull();
    await updateVariant(v.id, { sku: v.sku, barcode: "YENI-38" }, ctx);
    expect((await db.query.variants.findFirst({ where: eq(schema.variants.id, v.id) }))!.trendyolImportedAt).toBeNull();
  });
});

// ---------- Renk kartları (2026-11-06: 4 renkli ürün sitede 2 renk görünüyordu) ----------

/** Trendyol'daki gibi: 4 renk kartı (4 içerik), ikişer kartın "Renk"i aynı, Web Color'ları farklı. */
function fourColorBoot(mainId = "BOT-4"): RawContent[] {
  const card = (contentId: number, renk: string, web: string, prefix: string, form: "tekil" | "dizi" = "tekil"): RawContent => ({
    contentId,
    productMainId: mainId,
    title: "Kadın Bot",
    category: { id: 1, name: "Bot" },
    images: [{ url: `https://cdn.dsmcdn.com/ty1/${prefix}-1.jpg` }, { url: `https://cdn.dsmcdn.com/ty1/${prefix}-2.jpg` }],
    attributes:
      form === "dizi"
        ? [
            { attributeName: "Renk", attributeValues: [{ attributeValue: renk }] },
            { attributeName: "Web Color", attributeValues: [{ attributeValue: web }] },
          ]
        : [
            { attributeName: "Renk", attributeValue: renk },
            { attributeName: "Web Color", attributeValue: web },
          ],
    variants: ["37", "38"].map((size) => ({
      barcode: `${prefix}-${size}`,
      attributes: beden(size),
      onSale: true,
      stock: { quantity: 2 },
      price: { salePrice: 1999.99 },
    })),
  });
  return [
    card(104, "Siyah", "Kahverengi", "SK", "dizi"),
    card(101, "Siyah", "Siyah", "SS"),
    card(102, "Kahve", "Kahverengi", "KK", "dizi"),
    card(103, "Kahve", "Kahve", "KK2"),
  ];
}

describe("renk kartları", () => {
  test("her Trendyol renk kartı ayrı renk olur; aynı adlılar ayırt edilir", async () => {
    fake.contents = fourColorBoot();
    const { candidates } = await listTrendyolImportCandidates(ctx, deps());
    // Sıra içerik kimliğine göre sabit: 101 ve 102 adını korur, 104 Web Color'la ayrılır, 103'ün Web Color'ı aynı: numara alır
    expect(candidates[0]!.colorNames).toEqual(["Siyah", "Kahve", "Kahve 2", "Siyah (Kahverengi)"]);

    const [result] = await importTrendyolProducts(["BOT-4"], ctx, deps());
    expect(result).toMatchObject({ status: "created" });
    const p = (await productByMainId("BOT-4"))!;
    expect(p.colors).toHaveLength(4);
    const byName = new Map(p.colors.map((c) => [c.name, c]));
    expect(byName.get("Siyah")!.variants.map((v) => v.barcode).sort()).toEqual(["SS-37", "SS-38"]);
    expect(byName.get("Siyah (Kahverengi)")!.variants.map((v) => v.barcode).sort()).toEqual(["SK-37", "SK-38"]);
    expect(byName.get("Kahve 2")!.variants.map((v) => v.barcode).sort()).toEqual(["KK2-37", "KK2-38"]);
    for (const c of p.colors) {
      expect(c.images).toHaveLength(2);
      expect(c.trendyolKey).not.toBeNull();
    }
    expect(p.colors.map((c) => c.position).sort()).toEqual([0, 1, 2, 3]);
  });

  test("içerik düzeyindeki attributeValues dizisinden renk okunur; bozuk tek özellik diğerlerini düşürmez", async () => {
    fake.contents = [
      {
        ...fourColorBoot()[0]!,
        attributes: [
          { attributeName: "Materyal", attributeValue: { bozuk: true } as unknown as string },
          { attributeName: "Renk", attributeValues: [{ attributeValue: "Vizon" }] },
        ],
      },
    ];
    const { candidates } = await listTrendyolImportCandidates(ctx, deps());
    expect(candidates[0]!.colorNames).toEqual(["Vizon"]);
  });

  test("site rengi yeniden adlandırılsa da sonradan eklenen numara aynı renge gider", async () => {
    fake.contents = fourColorBoot();
    await importTrendyolProducts(["BOT-4"], ctx, deps());
    const p = (await productByMainId("BOT-4"))!;
    const siyah = p.colors.find((c) => c.name === "Siyah")!;
    await db.update(schema.productColors).set({ name: "Gece siyahı" }).where(eq(schema.productColors.id, siyah.id));

    fake.contents.find((c) => c.contentId === 101)!.variants.push({
      barcode: "SS-39",
      attributes: beden("39"),
      onSale: true,
      stock: { quantity: 1 },
      price: { salePrice: 1999.99 },
    });
    const [result] = await importTrendyolProducts(["BOT-4"], ctx, deps());
    expect(result).toMatchObject({ status: "updated", added: ["Gece siyahı 39"], moved: [] });
    expect((await variantByBarcode("SS-39")).colorId).toBe(siyah.id);
    expect((await productByMainId("BOT-4"))!.colors).toHaveLength(4);
  });

  test("eski aktarımın birleştirdiği ürün yeniden aktarınca düzelir: eksik kartlar gelir, karışık görseller yenilenir", async () => {
    // Eski hatalı aktarımın bıraktığı durum: aynı adlı ikinci kartların numaraları "iki kez var" diye atlanmış,
    // görselleri ilk kartın rengine karışmış, renklerde Trendyol anahtarı yok
    const all = fourColorBoot();
    fake.contents = all.filter((c) => c.contentId === 101 || c.contentId === 102);
    await importTrendyolProducts(["BOT-4"], ctx, deps());
    const before = (await productByMainId("BOT-4"))!;
    expect(before.colors).toHaveLength(2);
    await db.update(schema.productColors).set({ trendyolKey: null });
    for (const c of before.colors) {
      await db.insert(schema.productImages).values({ colorId: c.id, storageKey: `p/${crypto.randomUUID()}`, width: 400, height: 400, alt: "karışık", position: 9 });
    }
    const stockBefore = (await variantByBarcode("SS-37")).stock;

    fake.contents = all;
    const { candidates } = await listTrendyolImportCandidates(ctx, deps());
    expect(candidates[0]).toMatchObject({ newItems: 4, existingItems: 4, misplacedItems: 0 });

    imageRequests = [];
    const [result] = await importTrendyolProducts(["BOT-4"], ctx, deps());
    expect(result!.status).toBe("updated");
    expect(result!.added.sort()).toEqual(["Kahve 2 37", "Kahve 2 38", "Siyah (Kahverengi) 37", "Siyah (Kahverengi) 38"]);

    const after = (await productByMainId("BOT-4"))!;
    expect(after.colors.map((c) => c.name).sort()).toEqual(["Kahve", "Kahve 2", "Siyah", "Siyah (Kahverengi)"]);
    for (const c of after.colors) {
      expect(c.variants).toHaveLength(2);
      expect(c.images).toHaveLength(2);
      expect(c.images.some((i) => i.alt === "karışık")).toBe(false);
      expect(c.trendyolKey).not.toBeNull();
    }
    expect((await variantByBarcode("SS-37")).stock).toBe(stockBefore);
    expect(imageRequests).toHaveLength(8);

    const { candidates: again } = await listTrendyolImportCandidates(ctx, deps());
    expect(again[0]).toMatchObject({ newItems: 0, misplacedItems: 0 });
  });

  test("yanlış renkte duran numara doğru renge taşınır; boş kalan renk silinir", async () => {
    const all = fourColorBoot();
    fake.contents = all;
    await importTrendyolProducts(["BOT-4"], ctx, deps());
    const p = (await productByMainId("BOT-4"))!;
    const siyah = p.colors.find((c) => c.name === "Siyah")!;
    const ikinci = p.colors.find((c) => c.name === "Siyah (Kahverengi)")!;
    // İkinci kartın numaraları farklı olsaydı eski aktarım onları ilk karta koyardı
    for (const [barcode, size] of [["SK-37", "39"], ["SK-38", "40"]] as const) {
      await db.update(schema.variants).set({ colorId: siyah.id, size }).where(eq(schema.variants.barcode, barcode));
    }
    await db.delete(schema.productColors).where(eq(schema.productColors.id, ikinci.id));
    // Adı Trendyol'daki hiçbir karta uymayan eski renk: numaraları yeni renge geçer, kendisi boş kalıp silinir
    const eski = p.colors.find((c) => c.name === "Kahve 2")!;
    await db.update(schema.productColors).set({ name: "Eski ad" }).where(eq(schema.productColors.id, eski.id));
    await db.update(schema.productColors).set({ trendyolKey: null });
    all.find((c) => c.contentId === 104)!.variants.forEach((v, i) => (v.attributes = beden(["39", "40"][i]!)));

    const { candidates } = await listTrendyolImportCandidates(ctx, deps());
    expect(candidates[0]).toMatchObject({ newItems: 0, misplacedItems: 4 });
    const [result] = await importTrendyolProducts(["BOT-4"], ctx, deps());
    expect(result!.moved.sort()).toEqual(["Kahve 2 37", "Kahve 2 38", "Siyah (Kahverengi) 39", "Siyah (Kahverengi) 40"]);
    const after = (await productByMainId("BOT-4"))!;
    expect(after.colors.map((c) => c.name).sort()).toEqual(["Kahve", "Kahve 2", "Siyah", "Siyah (Kahverengi)"]);
    expect(await db.select().from(schema.productColors).where(eq(schema.productColors.id, eski.id))).toHaveLength(0);
    expect(after.colors.find((c) => c.name === "Siyah")!.variants.map((v) => v.barcode).sort()).toEqual(["SS-37", "SS-38"]);
    expect(after.colors.map((c) => c.position).sort()).toEqual([0, 1, 2, 3]);
  });

  test("elle kurulmuş ürünün renklerine ve görsellerine dokunulmaz", async () => {
    fake.contents = fourColorBoot();
    const { product, variants: vs } = await makeProduct({ colors: [{ name: "Gece", sizes: [{ size: "37", stock: 3 }] }] });
    await db.update(schema.variants).set({ barcode: "SS-37" }).where(eq(schema.variants.id, vs[0]!.id));
    const { candidates } = await listTrendyolImportCandidates(ctx, deps());
    expect(candidates[0]).toMatchObject({ misplacedItems: 0, existingItems: 1 });
    const [result] = await importTrendyolProducts(["BOT-4"], ctx, deps());
    expect(result!.moved).toEqual([]);
    expect((await variantByBarcode("SS-37")).colorId).toBe(vs[0]!.colorId);
    const after = await db.select().from(schema.productColors).where(eq(schema.productColors.id, vs[0]!.colorId));
    expect(after).toHaveLength(1);
    expect(product.id).toBe(result!.productId);
  });

  test("tek içerikte numaralar farklı renkteyse renkler ayrılır", async () => {
    const [first] = fourColorBoot();
    fake.contents = [
      {
        ...first!,
        attributes: [],
        variants: [
          { barcode: "MIX-37", attributes: [...beden("37"), ...renk("Bej")], onSale: true, stock: { quantity: 1 }, price: { salePrice: 999 } },
          { barcode: "MIX-38", attributes: [...beden("38"), ...renk("Lacivert")], onSale: true, stock: { quantity: 1 }, price: { salePrice: 999 } },
        ],
      },
    ];
    const { candidates } = await listTrendyolImportCandidates(ctx, deps());
    expect(candidates[0]!.colorNames).toEqual(["Bej", "Lacivert"]);
  });
});
