import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Tx } from "@/server/db";
import { logError } from "@/server/log";
import { deleteProductImage, ImageError, storeProductImage, type StoredImage } from "@/server/storage/images";
import { TrendyolError, type TrendyolClient, type TrendyolApprovedContent } from "@/server/trendyol/client";
import {
  DEFAULT_TRENDYOL_DISCOUNT,
  discountedPrice,
  fetchTrendyolImage,
  groupContents,
  ImageFetchError,
  type ImportGroup,
  type ImportProblem,
} from "@/server/trendyol/products";
import { audit } from "../audit";
import { setStock } from "../stock";
import { barcodeSchema, buildSku, freeSku, freeSlug, MAX_COLORS_PER_PRODUCT, MAX_STOCK, slugBase } from "./catalog";
import { AdminError, assertAdmin, isUniqueViolation, type AdminContext } from "./context";

/**
 * Trendyol → site ürün aktarımı. Aynı productMainId'li Trendyol içerikleri tek site ürünü olur (taslak);
 * her içerik bir renk, her numara Trendyol barkoduyla bir beden. Stok "initial" hareketiyle girilir.
 *
 * Ortak stokla ilişki (çift sayım olmasın):
 * - Aktarılan adet Trendyol'un o anki stoğudur; Trendyol'da o ana kadar verilmiş siparişler bu adetten zaten düşülmüş.
 *   Bu yüzden (a) bu barkodun henüz eşleşmemiş Trendyol sipariş kayıtları "düşülmüş" sayılır, (b) numaraya
 *   aktarım anı yazılır ve senkron, bu andan önce verilmiş ama henüz çekilmemiş siparişleri stoktan düşmez.
 * - Trendyol'a gönderilen son stok kaydı aktarılan adetle yazılır: aynı değer Trendyol'a boşuna geri gönderilmez;
 *   stok sitede değişince senkron her zamanki gibi gönderir.
 */

const { products, productColors, productImages, variants, categories, trendyolStockPush, trendyolOrderStock } = schema;

const MAX_LIST_PAGES = 50;
// Görsel indirme uzun sürebilir; tek istek vekil zaman aşımına (Cloudflare 100 sn) takılmasın
const MAX_GROUPS_PER_IMPORT = 8;
const MAX_IMAGES_PER_IMPORTED_COLOR = 8;
// Trendyol ürün uçları 10 saniyede en fazla 50 istek kabul eder
const PAGE_PAUSE_MS = 250;
// Trendyol'a gönderilebilen en yüksek adet (senkronla aynı)
const MAX_PUSH_QUANTITY = 20000;

export type ImportDeps = {
  client: TrendyolClient;
  /** Görsel indirme (testte taklit edilir); varsayılan yalnızca Trendyol CDN'inden indirir */
  fetchImage?: (url: string) => Promise<Buffer>;
  now?: () => Date;
  pause?: (ms: number) => Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- Liste ----------

export type ImportCandidate = {
  productMainId: string;
  name: string;
  categoryName: string | null;
  colorNames: string[];
  sizes: string[];
  /** Sitede henüz olmayan numara sayısı ve stokları */
  newItems: number;
  newStock: number;
  existingItems: number;
  problems: ImportProblem[];
  trendyolPrice: number | null;
  /** Yeni ürün olursa varsayılan indirimle site fiyatı */
  sitePrice: number | null;
  /** Bu ürün (productMainId ya da barkodla) sitede varsa */
  siteProduct: { id: string; name: string } | null;
};

async function fetchAllContents(deps: ImportDeps, productMainId?: string) {
  const pause = deps.pause ?? sleep;
  const contents: TrendyolApprovedContent[] = [];
  let skipped = 0;
  let truncated = false;
  for (let page = 0; ; page++) {
    if (page >= (productMainId ? 5 : MAX_LIST_PAGES)) {
      truncated = true;
      break;
    }
    if (page > 0) await pause(PAGE_PAUSE_MS);
    const res = await deps.client.approvedProducts({ page, size: 100, productMainId });
    contents.push(...res.contents);
    skipped += res.skipped;
    if (!res.hasMore) break;
  }
  return { contents: productMainId ? contents.filter((c) => c.productMainId === productMainId) : contents, skipped, truncated };
}

/** Sitede bulunan barkodlar → ürün. */
async function siteBarcodes(barcodes: string[], tx: Tx | typeof db = db) {
  const out = new Map<string, { productId: string; productName: string }>();
  for (let i = 0; i < barcodes.length; i += 1000) {
    const chunk = barcodes.slice(i, i + 1000);
    if (!chunk.length) continue;
    const rows = await tx
      .select({ barcode: variants.barcode, productId: products.id, productName: products.name })
      .from(variants)
      .innerJoin(productColors, eq(productColors.id, variants.colorId))
      .innerJoin(products, eq(products.id, productColors.productId))
      .where(inArray(variants.barcode, chunk));
    for (const r of rows) out.set(r.barcode!, { productId: r.productId, productName: r.productName });
  }
  return out;
}

async function productsByMainId(mainIds: string[]) {
  const out = new Map<string, { id: string; name: string }>();
  for (let i = 0; i < mainIds.length; i += 1000) {
    const chunk = mainIds.slice(i, i + 1000);
    if (!chunk.length) continue;
    const rows = await db
      .select({ id: products.id, name: products.name, mainId: products.trendyolMainId })
      .from(products)
      .where(inArray(products.trendyolMainId, chunk));
    for (const r of rows) out.set(r.mainId!, { id: r.id, name: r.name });
  }
  return out;
}

/** Trendyol'daki onaylı ürünler, siteye göre durumlarıyla. */
export async function listTrendyolImportCandidates(
  ctx: AdminContext,
  deps: ImportDeps,
): Promise<{ candidates: ImportCandidate[]; skipped: number; truncated: boolean }> {
  await assertAdmin(ctx);
  const { contents, skipped, truncated } = await fetchAllContents(deps);
  const groups = groupContents(contents);
  const onSite = await siteBarcodes([...new Set(groups.flatMap((g) => g.colors.flatMap((c) => c.items.map((i) => i.barcode))))]);
  const byMainId = await productsByMainId(groups.map((g) => g.productMainId));
  const candidates = groups.map((g): ImportCandidate => {
    const items = g.colors.flatMap((c) => c.items);
    const fresh = items.filter((i) => !onSite.has(i.barcode));
    const owner = byMainId.get(g.productMainId) ?? items.map((i) => onSite.get(i.barcode)).find(Boolean);
    return {
      productMainId: g.productMainId,
      name: g.name,
      categoryName: g.categoryName,
      colorNames: g.colors.map((c) => c.name),
      sizes: [...new Set(items.map((i) => i.size))],
      newItems: fresh.length,
      newStock: fresh.reduce((n, i) => n + i.quantity, 0),
      existingItems: items.length - fresh.length,
      problems: g.problems,
      trendyolPrice: g.trendyolPrice,
      sitePrice: g.trendyolPrice ? discountedPrice(g.trendyolPrice, DEFAULT_TRENDYOL_DISCOUNT) : null,
      siteProduct: owner ? { id: "productId" in owner ? owner.productId : owner.id, name: "productName" in owner ? owner.productName : owner.name } : null,
    };
  });
  // Aktarılacak numarası olanlar önce
  candidates.sort((a, b) => Number(b.newItems > 0) - Number(a.newItems > 0) || a.name.localeCompare(b.name, "tr"));
  return { candidates, skipped, truncated };
}

// ---------- Aktarım ----------

export type ImportResult = {
  productMainId: string;
  name: string;
  status: "created" | "updated" | "skipped" | "failed";
  productId?: string;
  added: string[];
  problems: ImportProblem[];
  imageErrors: number;
  message?: string;
};

const mainIdsSchema = z
  .array(z.string().trim().min(1).max(200))
  .min(1, "Aktarılacak ürünleri seçin.")
  .max(MAX_GROUPS_PER_IMPORT, `Tek seferde en fazla ${MAX_GROUPS_PER_IMPORT} ürün aktarılabilir.`);

/** Seçilen productMainId'leri Trendyol'dan yeniden okuyup (istemcinin gönderdiği veriye güvenilmez) aktarır. */
export async function importTrendyolProducts(rawIds: string[], ctx: AdminContext, deps: ImportDeps): Promise<ImportResult[]> {
  await assertAdmin(ctx);
  const parsed = mainIdsSchema.safeParse(rawIds);
  if (!parsed.success) throw new AdminError(parsed.error.issues[0]?.message ?? "Geçersiz seçim.");
  const results: ImportResult[] = [];
  // Zaman Trendyol stoğu okunmadan ÖNCE alınır: bu ana kadarki siparişler okunan adede yansımış sayılır
  const startedAt = (deps.now ?? (() => new Date()))();
  for (const mainId of [...new Set(parsed.data)]) {
    let group: ImportGroup | undefined;
    try {
      const fetched = await fetchAllContents(deps, mainId);
      if (fetched.truncated) {
        // Ürünün bütün renkleri okunamadıysa eksik aktarılmaz
        results.push({
          productMainId: mainId,
          name: mainId,
          status: "failed",
          added: [],
          problems: [],
          imageErrors: 0,
          message: "Trendyol bu ürünü tek başına listelemedi; ürün aktarılmadı. Numaraları elle ekleyin.",
        });
        continue;
      }
      group = groupContents(fetched.contents)[0];
    } catch (e) {
      if (!(e instanceof TrendyolError)) throw e;
      results.push({ productMainId: mainId, name: mainId, status: "failed", added: [], problems: [], imageErrors: 0, message: e.message });
      continue;
    }
    if (!group) {
      results.push({
        productMainId: mainId,
        name: mainId,
        status: "skipped",
        added: [],
        problems: [],
        imageErrors: 0,
        message: "Trendyol'da bu ürün bulunamadı.",
      });
      continue;
    }
    results.push(await importGroup(group, ctx, deps, startedAt));
  }
  return results;
}

type Prepared = { colorName: string; images: StoredImage[] };

async function importGroup(group: ImportGroup, ctx: AdminContext, deps: ImportDeps, now: Date): Promise<ImportResult> {
  const base: ImportResult = {
    productMainId: group.productMainId,
    name: group.name,
    status: "skipped",
    added: [],
    problems: [...group.problems],
    imageErrors: 0,
  };
  // Sitenin barkod kuralına uymayan barkodlar alınmaz (yönetimde düzenlenemez olurdu)
  for (const color of group.colors) {
    color.items = color.items.filter((i) => {
      const ok = barcodeSchema.safeParse(i.barcode).success && i.barcode.length >= 4;
      if (!ok) base.problems.push({ barcode: i.barcode, reason: "Barkod biçimi sitede kullanılamıyor (harf, rakam, tire; 4–32 karakter)" });
      return ok;
    });
  }
  const allItems = group.colors.flatMap((c) => c.items);
  if (allItems.length === 0) return { ...base, message: "Aktarılabilecek numara yok." };

  const onSite = await siteBarcodes(allItems.map((i) => i.barcode));
  const [linked] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.trendyolMainId, group.productMainId));
  const owners = new Set([...onSite.values()].map((o) => o.productId));
  if (!linked && owners.size > 1) {
    return { ...base, message: "Bu ürünün barkodları sitede birden fazla üründe kayıtlı; numaraları elle ekleyin." };
  }
  const targetId = linked?.id ?? [...owners][0] ?? null;
  if (allItems.every((i) => onSite.has(i.barcode))) return { ...base, productId: targetId ?? undefined, message: "Tüm numaralar zaten sitede." };
  if (!targetId && !group.trendyolPrice) return { ...base, message: "Trendyol satış fiyatı okunamadı; ürün aktarılmadı." };

  // Görseller yalnızca sitede olmayan renkler için, işlem dışında indirilip işlenir
  const existingColors = targetId
    ? (await db.select({ name: productColors.name }).from(productColors).where(eq(productColors.productId, targetId))).map((c) =>
        c.name.toLocaleLowerCase("tr-TR"),
      )
    : [];
  const prepared: Prepared[] = [];
  const fetchImage = deps.fetchImage ?? ((url: string) => fetchTrendyolImage(url));
  for (const color of group.colors) {
    if (existingColors.includes(color.name.toLocaleLowerCase("tr-TR"))) continue;
    if (!color.items.some((i) => !onSite.has(i.barcode))) continue;
    const images: StoredImage[] = [];
    for (const url of color.images.slice(0, MAX_IMAGES_PER_IMPORTED_COLOR)) {
      try {
        images.push(await storeProductImage(await fetchImage(url)));
      } catch (e) {
        if (!(e instanceof ImageFetchError) && !(e instanceof ImageError)) logError("[trendyol-aktar] görsel", e);
        base.imageErrors++;
      }
    }
    prepared.push({ colorName: color.name, images });
  }
  const storedKeys = prepared.flatMap((p) => p.images.map((i) => i.key));
  // İşlemde kullanılmayan görseller (renk sınırı ya da bu arada eklenmiş renk) kayıttan sonra silinir
  const usedKeys = new Set<string>();

  try {
    const outcome = await db.transaction(async (tx) => {
      usedKeys.clear();
      const result: ImportResult = { ...base, problems: [...base.problems], added: [] };
      let productId = targetId;
      if (productId) {
        const [locked] = await tx.select({ id: products.id, mainId: products.trendyolMainId }).from(products).where(eq(products.id, productId)).for("update");
        if (!locked) throw new AdminError("Ürün bu arada silindi. Sayfayı yenileyip yeniden deneyin.");
        if (!locked.mainId) await tx.update(products).set({ trendyolMainId: group.productMainId }).where(eq(products.id, productId));
        result.status = "updated";
      } else {
        const categoryId = group.categoryName ? await categoryByName(tx, group.categoryName, ctx) : null;
        const tp = group.trendyolPrice!;
        const price = discountedPrice(tp, DEFAULT_TRENDYOL_DISCOUNT);
        const slug = await freeSlug("product", slugBase(group.name), null, tx);
        const [row] = await tx
          .insert(products)
          .values({
            name: group.name,
            slug,
            description: group.description,
            categoryId,
            price,
            trendyolPrice: tp > price ? tp : null,
            trendyolSalePrice: tp,
            trendyolDiscount: DEFAULT_TRENDYOL_DISCOUNT,
            trendyolMainId: group.productMainId,
            status: "draft",
          })
          .returning({ id: products.id });
        productId = row!.id;
        result.status = "created";
      }
      result.productId = productId;

      const colors = await tx
        .select({ id: productColors.id, name: productColors.name, position: productColors.position })
        .from(productColors)
        .where(eq(productColors.productId, productId))
        .orderBy(asc(productColors.position), asc(productColors.id));
      // Barkodlar işlem içinde yeniden denetlenir (bu arada başka bir numaraya yazılmış olabilir)
      const taken = await siteBarcodes(allItems.map((i) => i.barcode), tx);

      for (const color of group.colors) {
        const fresh = color.items.filter((i) => !taken.has(i.barcode));
        if (fresh.length === 0) continue;
        let target = colors.find((c) => c.name.toLocaleLowerCase("tr-TR") === color.name.toLocaleLowerCase("tr-TR"));
        if (!target) {
          if (colors.length >= MAX_COLORS_PER_PRODUCT) {
            for (const i of fresh) result.problems.push({ barcode: i.barcode, reason: "Üründe en fazla 20 renk olabilir" });
            continue;
          }
          const position = colors.reduce((m, c) => Math.max(m, c.position + 1), 0);
          const [inserted] = await tx
            .insert(productColors)
            .values({ productId, name: color.name, position })
            .returning({ id: productColors.id, name: productColors.name, position: productColors.position });
          target = inserted!;
          colors.push(target);
          const imgs = prepared.find((p) => p.colorName === color.name)?.images ?? [];
          for (const img of imgs) usedKeys.add(img.key);
          for (const [i, img] of imgs.entries()) {
            await tx.insert(productImages).values({
              colorId: target.id,
              storageKey: img.key,
              width: img.width,
              height: img.height,
              alt: `${group.name} – ${color.name}`.slice(0, 200),
              position: i,
            });
          }
        }
        const colorIndex = colors.findIndex((c) => c.id === target.id);
        const sizesInColor = new Set(
          (await tx.select({ size: variants.size }).from(variants).where(eq(variants.colorId, target.id))).map((v) => v.size),
        );
        for (const item of fresh) {
          if (sizesInColor.has(item.size)) {
            result.problems.push({ barcode: item.barcode, reason: `${color.name} renginde ${item.size} numarası sitede başka barkodla var` });
            continue;
          }
          const sku = await freeSku(buildSku(productId, colorIndex, item.size), tx);
          const [v] = await tx
            .insert(variants)
            .values({ colorId: target.id, size: item.size, sku, barcode: item.barcode, stock: 0, trendyolImportedAt: now })
            .returning({ id: variants.id });
          const quantity = Math.min(item.quantity, MAX_STOCK);
          if (quantity > 0) {
            await setStock(tx, v!.id, quantity, {
              reason: "initial",
              reference: `Trendyol ${group.productMainId}`.slice(0, 200),
              note: "Trendyol'dan aktarım (Trendyol stoğu)",
              actorId: ctx.actorId,
            });
          }
          await settleImported(tx, v!.id, item.barcode, Math.min(quantity, MAX_PUSH_QUANTITY), now);
          sizesInColor.add(item.size);
          result.added.push(`${color.name} ${item.size}`);
        }
      }
      for (const [barcode, owner] of taken) {
        if (owner.productId !== productId) result.problems.push({ barcode, reason: `Barkod sitede "${owner.productName}" ürününde kayıtlı` });
      }
      if (result.added.length === 0) throw new NothingAdded(result);

      await audit(
        {
          action: "product.trendyol_import",
          actorId: ctx.actorId,
          target: productId,
          data: { productMainId: group.productMainId, status: result.status, added: result.added, problems: result.problems.length },
          ip: ctx.ip,
        },
        tx,
      );
      return result;
    });
    await Promise.all(storedKeys.filter((k) => !usedKeys.has(k)).map((k) => deleteProductImage(k)));
    return outcome;
  } catch (e) {
    await Promise.all(storedKeys.map((k) => deleteProductImage(k)));
    if (e instanceof NothingAdded) return { ...e.result, status: "skipped", message: e.result.message ?? "Eklenecek yeni numara yok." };
    if (e instanceof AdminError) return { ...base, status: "failed", message: e.message };
    if (isUniqueViolation(e)) {
      return {
        ...base,
        status: "failed",
        message: "Barkod ya da ürün bu arada başka bir kayıtta kullanıldı (çakışma). Sayfayı yenileyip yeniden deneyin.",
      };
    }
    logError("[trendyol-aktar]", e);
    return { ...base, status: "failed", message: "Ürün aktarılamadı; sunucu kayıtlarına bakın." };
  }
}

class NothingAdded extends Error {
  constructor(public result: ImportResult) {
    super("nothing added");
  }
}

/**
 * Aktarılan numaranın ortak stok kayıtları: henüz eşleşmemiş Trendyol siparişleri Trendyol stoğunda zaten düşülmüş
 * sayılır; Trendyol'a gönderilen son adet aktarılan adet olur (aynı değer geri gönderilmez).
 */
async function settleImported(tx: Tx, variantId: string, barcode: string, quantity: number, now: Date) {
  await tx
    .update(trendyolOrderStock)
    .set({ variantId, deducted: sql`${trendyolOrderStock.quantity}`, shortfall: 0 })
    .where(and(eq(trendyolOrderStock.barcode, barcode), isNull(trendyolOrderStock.variantId)));
  const values = { variantId, quantity, batchRequestId: null, status: "ok" as const, error: null, attempts: 0, pushedAt: now };
  await tx
    .insert(trendyolStockPush)
    .values({ barcode, ...values })
    .onConflictDoUpdate({ target: trendyolStockPush.barcode, set: values });
}

/** Trendyol kategori adıyla site kategorisi: aynı adlı (büyük/küçük harf duyarsız) varsa o, yoksa yenisi. */
async function categoryByName(tx: Tx, name: string, ctx: AdminContext): Promise<string> {
  await tx.execute(sql`lock table ${categories} in share row exclusive mode`);
  const [found] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(sql`lower(${categories.name}) = lower(${name})`)
    .limit(1);
  if (found) return found.id;
  const slug = await freeSlug("category", slugBase(name, "kategori"), null, tx);
  const [{ position }] = (await tx.execute<{ position: number }>(
    sql`select coalesce(max(position) + 1, 0)::int as position from ${categories}`,
  )).rows as [{ position: number }];
  const [row] = await tx.insert(categories).values({ name, slug, position: Number(position) }).returning({ id: categories.id });
  await audit({ action: "category.create", actorId: ctx.actorId, target: row!.id, data: { name, slug, source: "trendyol" }, ip: ctx.ip }, tx);
  return row!.id;
}
