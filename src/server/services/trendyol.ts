import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, pool, schema, type Tx } from "@/server/db";
import { describeError } from "@/server/log";
import { TrendyolError, trendyolConfig, type TrendyolClient, type TrendyolPackage } from "@/server/trendyol/client";
import { audit } from "./audit";
import { returnStock } from "./stock";

/**
 * Trendyol ile ortak stok. Kaynak sitedeki `variants.stock`:
 * 1. Trendyol'da son güncellenen paketler çekilir; her sipariş+barkod için düşülmesi gereken adet
 *    paket durumlarından yeniden hesaplanır ve stok farkı kadar düşülür ya da geri konur (idempotent).
 * 2. Barkodu olan her numaranın satılabilir stoğu, değiştiyse Trendyol'a gönderilir.
 * Zamanlanmış görev: npm run trendyol:sync (birkaç dakikada bir).
 */

const { trendyolPackages, trendyolOrderStock, trendyolStockPush, variants, productColors, products, stockMovements } = schema;

// Bu durumlardaki paket/kalem stok tutmaz (iptal, tedarik edilemedi, bölünüp yeni pakete taşındı)
const RELEASED = new Set(["Cancelled", "UnSupplied", "UnPacked"]);

const HOUR = 3600_000;
// Trendyol tarihleri GMT+3'e göre yorumlayabiliyor; pencere iki yönde geniş tutulur, işleme idempotent
const OVERLAP_MS = 4 * HOUR;
const FUTURE_MS = 3 * HOUR;
// Trendyol en fazla 14 günlük aralık kabul eder
const MAX_LOOKBACK_MS = 13 * 24 * HOUR;
const MAX_PAGES = 50;
const PAGE_PAUSE_MS = 5000;
const MAX_QUANTITY = 20000;
const PUSH_CHUNK = 1000;
// Trendyol aynı isteği 15 dakika içinde tekrar kabul etmez; reddedilen gönderim bu süreden sonra yinelenir
const RETRY_FAILED_MS = 16 * 60_000;
// Trendyol toplu işlem sonucunu 4 saat saklar
const BATCH_TTL_MS = 4 * HOUR;
const BATCH_MIN_AGE_MS = 20_000;

const STATE_KEY = "trendyol.sync";
// Karşılaştırma fiyatı (vitrinde "Trendyol'da X TL") saatte bir yenilenir
const PRICE_SYNC_MS = HOUR;

export type SyncState = {
  /** Son başarılı çekimin başladığı an (Unix ms); yoksa ilk çalıştırma (başlangıç kaydı) */
  cursor?: number;
  /** İlk çalıştırmanın anı: bundan önce verilmiş siparişler stoktan düşülmez (stok zaten buna göre girilmişti) */
  baselineAt?: number;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastError?: string | null;
  lastSummary?: SyncSummary;
  lastPriceSyncAt?: number;
  /** Trendyol'da sitedekinden ucuz ya da aynı fiyata satılan ürünler (vitrinde karşılaştırma gösterilmez) */
  priceWarnings?: PriceWarning[];
};

export type PriceWarning = { productId: string; name: string; price: number; trendyolPrice: number };

export type SyncSummary = {
  baseline: boolean;
  packages: number;
  skippedPackages: number;
  /** Senkron 13 günden uzun çalışmadı; aradaki değişiklikler alınamadı */
  windowClipped: boolean;
  orders: number;
  deducted: number;
  returned: number;
  shortfall: number;
  pushed: number;
  pushErrors: string[];
  batchesChecked: number;
  /** Güncellenen Trendyol karşılaştırma fiyatı sayısı (fiyat bu çalıştırmada okunmadıysa null) */
  pricesUpdated: number | null;
  priceError?: string;
};

export type SyncDeps = {
  client: TrendyolClient;
  now?: () => Date;
  pause?: (ms: number) => Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function getSyncState(): Promise<SyncState> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, STATE_KEY) });
  return (row?.value as SyncState | undefined) ?? {};
}

async function saveSyncState(state: SyncState) {
  await db
    .insert(schema.settings)
    .values({ key: STATE_KEY, value: state })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: state } });
}

/**
 * Tek çalıştırma. Aynı anda ikinci bir çalıştırma varsa hiçbir şey yapmadan null döner.
 * Hata olursa durum kaydına yazılır ve fırlatılır.
 */
export async function runTrendyolSync(deps: SyncDeps): Promise<SyncSummary | null> {
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtext('trendyol-sync')) as ok");
    if (!rows[0]?.ok) return null;
    try {
      return await runLocked(deps);
    } finally {
      await lockClient.query("select pg_advisory_unlock(hashtext('trendyol-sync'))");
    }
  } finally {
    lockClient.release();
  }
}

async function runLocked(deps: SyncDeps): Promise<SyncSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const state = await getSyncState();
  const runAt = now.toISOString();
  try {
    const pulled = await pullOrders(deps, state, now);
    const batchesChecked = await checkPushResults(deps, now);
    const push = await pushStock(deps, now);
    const prices = await syncPricesIfDue(deps, state, now);
    const summary: SyncSummary = { ...pulled, ...push, batchesChecked, pricesUpdated: prices.updated, priceError: prices.error };
    await saveSyncState({
      lastPriceSyncAt: prices.ranAt ?? state.lastPriceSyncAt,
      priceWarnings: prices.warnings ?? state.priceWarnings,
      cursor: now.getTime(),
      baselineAt: state.baselineAt ?? (pulled.baseline ? now.getTime() : undefined),
      lastRunAt: runAt,
      lastSuccessAt: push.pushErrors.length ? state.lastSuccessAt : runAt,
      lastError: push.pushErrors.length ? `Stok gönderimi: ${push.pushErrors[0]}` : null,
      lastSummary: summary,
    });
    return summary;
  } catch (e) {
    const message = e instanceof TrendyolError ? e.message : describeError(e).split("\n")[0]!;
    // Çekim başarısızsa imleç ilerlemez; sonraki çalıştırma aynı pencereyi yeniden dener
    await saveSyncState({ ...state, lastRunAt: runAt, lastError: message });
    throw e;
  }
}

// ---------- 1. Trendyol siparişleri → stok ----------

async function pullOrders(deps: SyncDeps, state: SyncState, now: Date) {
  const pause = deps.pause ?? sleep;
  const baseline = state.cursor === undefined;
  const floor = now.getTime() - MAX_LOOKBACK_MS;
  const start = baseline ? floor : Math.max(state.cursor! - OVERLAP_MS, floor);
  const windowClipped = !baseline && state.cursor! - OVERLAP_MS < floor;
  // İlk çalıştırmada bu an kaydedilir; sonraki çalıştırmalarda kayıtlı değer kullanılır
  const baselineAt = state.baselineAt ?? (baseline ? now.getTime() : undefined);
  const end = now.getTime() + FUTURE_MS;

  const seen = new Map<string, TrendyolPackage>();
  let skippedPackages = 0;
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new TrendyolError("Bir çalıştırmada çok fazla paket değişti; senkron durduruldu");
    if (page > 0) await pause(PAGE_PAUSE_MS);
    const res = await deps.client.ordersStream({ start, end, cursor });
    skippedPackages += res.skipped;
    // Akış en yeniden eskiye gelir; aynı paket iki kez gelirse yenisi kalır
    for (const p of res.packages) if (!seen.has(p.id)) seen.set(p.id, p);
    if (!res.hasMore) break;
    cursor = res.nextCursor;
  }

  const orderNumbers = new Set<string>();
  for (const p of seen.values()) {
    if (await savePackage(p)) orderNumbers.add(p.orderNumber);
  }
  // Stok yetmeyen kalemler ve barkodu sonradan bir numaraya yazılmış eşleşmeyen kalemler yeniden denenir
  const open = await db
    .select({ orderNumber: trendyolOrderStock.orderNumber })
    .from(trendyolOrderStock)
    .where(
      sql`${trendyolOrderStock.quantity} > ${trendyolOrderStock.deducted} and (${trendyolOrderStock.variantId} is not null
        or exists (select 1 from ${variants} where ${variants.barcode} = ${trendyolOrderStock.barcode}))`,
    )
    .orderBy(asc(trendyolOrderStock.updatedAt))
    .limit(500);
  for (const u of open) orderNumbers.add(u.orderNumber);

  let deducted = 0;
  let returned = 0;
  let shortfall = 0;
  for (const orderNumber of orderNumbers) {
    const r = await applyOrder(orderNumber, baselineAt, baseline);
    deducted += r.deducted;
    returned += r.returned;
    shortfall += r.shortfall;
  }
  return { baseline, packages: seen.size, skippedPackages, windowClipped, orders: orderNumbers.size, deducted, returned, shortfall };
}

/** Paketi kaydeder; kayıtlı olan daha yeniyse dokunmaz. Değiştiyse true. */
async function savePackage(p: TrendyolPackage): Promise<boolean> {
  const values = {
    id: p.id,
    orderNumber: p.orderNumber,
    status: p.status,
    lines: p.lines,
    orderDate: p.orderDate,
    lastModifiedAt: p.lastModifiedAt,
  };
  const rows = await db
    .insert(trendyolPackages)
    .values(values)
    .onConflictDoUpdate({
      target: trendyolPackages.id,
      set: {
        orderNumber: values.orderNumber,
        status: values.status,
        lines: values.lines,
        orderDate: sql`coalesce(excluded.order_date, ${trendyolPackages.orderDate})`,
        lastModifiedAt: values.lastModifiedAt,
      },
      setWhere: sql`${trendyolPackages.lastModifiedAt} is null or excluded.last_modified_at is null
        or excluded.last_modified_at >= ${trendyolPackages.lastModifiedAt}`,
    })
    .returning({ id: trendyolPackages.id });
  return rows.length > 0;
}

/** Siparişin paketlerine göre olması gereken adetler (barkod → adet). */
function wantedByBarcode(packages: { status: string; lines: schema.TrendyolLine[] }[]) {
  const wanted = new Map<string, number>();
  for (const p of packages) {
    if (RELEASED.has(p.status)) continue;
    for (const l of p.lines) {
      if (RELEASED.has(l.status) || !l.barcode || l.quantity <= 0) continue;
      wanted.set(l.barcode, (wanted.get(l.barcode) ?? 0) + l.quantity);
    }
  }
  return wanted;
}

/**
 * Bir Trendyol siparişinin stok etkisini paketlerle eşitler.
 * Senkron açılmadan önce verilmiş (sipariş tarihi baselineAt'ten eski) siparişler ilk görüldüklerinde stok
 * değiştirilmeden "zaten düşülmüş" kabul edilir: senkron açılırken site stoğu bunlara göre girilmiştir.
 * Böylece eski bir siparişin sonradan gelen iade/teslim güncellemesi stoğu düşürmez.
 */
async function applyOrder(orderNumber: string, baselineAt: number | undefined, baselineRun: boolean) {
  return db.transaction(async (tx) => {
    const result = { deducted: 0, returned: 0, shortfall: 0 };
    const packages = await tx
      .select({ status: trendyolPackages.status, lines: trendyolPackages.lines, orderDate: trendyolPackages.orderDate })
      .from(trendyolPackages)
      .where(eq(trendyolPackages.orderNumber, orderNumber));
    const wanted = wantedByBarcode(packages);
    const dates = packages.map((p) => p.orderDate?.getTime()).filter((d): d is number => d !== undefined);
    const orderedAt = dates.length ? Math.min(...dates) : undefined;
    // Sipariş tarihi gelmediyse yalnızca ilk çalıştırmada eski sayılır
    const preexisting = orderedAt !== undefined && baselineAt !== undefined ? orderedAt < baselineAt : baselineRun;
    const existing = await tx
      .select()
      .from(trendyolOrderStock)
      .where(eq(trendyolOrderStock.orderNumber, orderNumber))
      .for("update");
    const rows = new Map(existing.map((r) => [r.barcode, r]));

    // Numaralar, ödeme akışıyla aynı sırada (kimliğe göre) kilitlensin: eşzamanlı siparişle kilitlenme olmasın
    const entries = [];
    for (const barcode of new Set([...wanted.keys(), ...rows.keys()])) {
      const want = wanted.get(barcode) ?? 0;
      const row = rows.get(barcode);
      if (!row && want === 0) continue;
      entries.push({ barcode, want, row, variantId: row?.variantId ?? (await matchVariant(tx, barcode)) });
    }
    entries.sort((x, y) => (x.variantId ?? "~").localeCompare(y.variantId ?? "~"));

    for (const { barcode, want, row, variantId } of entries) {
      let deducted = row?.deducted ?? 0;
      const reference = `Trendyol ${orderNumber}`;
      if (!row && preexisting) {
        deducted = want;
      } else if (variantId && want > deducted) {
        // Stok yetmezse kalan adet eksik olarak durur; stok geldiğinde (ör. site siparişi iptal) sonraki çalıştırmada düşülür
        const taken = await takeAvailable(tx, variantId, want - deducted, reference);
        deducted += taken;
        result.deducted += taken;
      } else if (variantId && want < deducted) {
        const back = deducted - want;
        await returnStock(tx, variantId, back, { reason: "trendyol", reference, note: "Trendyol iptali" });
        deducted = want;
        result.returned += back;
      } else if (!variantId) {
        deducted = Math.min(deducted, want);
      }
      const short = variantId ? want - deducted : 0;
      if (short > (row?.shortfall ?? 0)) result.shortfall += short - (row?.shortfall ?? 0);
      const values = { variantId, quantity: want, deducted, shortfall: short };
      if (row) {
        await tx
          .update(trendyolOrderStock)
          .set(values)
          .where(and(eq(trendyolOrderStock.orderNumber, orderNumber), eq(trendyolOrderStock.barcode, barcode)));
      } else {
        await tx.insert(trendyolOrderStock).values({ orderNumber, barcode, ...values });
      }
    }
    return result;
  });
}

async function matchVariant(tx: Tx, barcode: string): Promise<string | null> {
  const [v] = await tx.select({ id: variants.id }).from(variants).where(eq(variants.barcode, barcode)).limit(1);
  return v?.id ?? null;
}

/** Yettiği kadar düşer (Trendyol'da satış zaten oldu); düşülen adedi döner. */
async function takeAvailable(tx: Tx, variantId: string, quantity: number, reference: string): Promise<number> {
  const [v] = await tx.select({ stock: variants.stock }).from(variants).where(eq(variants.id, variantId)).for("update");
  const taken = Math.min(v?.stock ?? 0, quantity);
  if (taken > 0) {
    await tx.update(variants).set({ stock: sql`${variants.stock} - ${taken}` }).where(eq(variants.id, variantId));
    await tx.insert(stockMovements).values({
      variantId,
      delta: -taken,
      reason: "trendyol",
      reference,
      note: taken < quantity ? `Trendyol satışı; ${quantity - taken} adet için stok yoktu` : "Trendyol satışı",
    });
  }
  return taken;
}

// ---------- 2. Site stoğu → Trendyol ----------

async function pushStock(deps: SyncDeps, now: Date) {
  const pushErrors: string[] = [];
  // Numaradan kaldırılan ya da değiştirilen eski barkod Trendyol'da son adetle satışta kalmasın: 0 gönderilir.
  // Barkod başka bir numaraya geçtiyse o numaranın stoğu gönderileceği için atlanır.
  const orphans = await db
    .select({ variantId: trendyolStockPush.variantId, barcode: trendyolStockPush.barcode })
    .from(trendyolStockPush)
    .innerJoin(variants, eq(variants.id, trendyolStockPush.variantId))
    .where(
      sql`${variants.barcode} is distinct from ${trendyolStockPush.barcode}
        and not exists (select 1 from variants v2 where v2.barcode = ${trendyolStockPush.barcode})`,
    )
    .limit(PUSH_CHUNK);
  if (orphans.length) {
    try {
      await deps.client.updateInventory(orphans.map((o) => ({ barcode: o.barcode, quantity: 0 })));
      // Kayıt silinir: numaranın yeni barkodu (varsa) aşağıda baştan gönderilir
      await db.delete(trendyolStockPush).where(inArray(trendyolStockPush.variantId, orphans.map((o) => o.variantId)));
    } catch (e) {
      if (!(e instanceof TrendyolError)) throw e;
      pushErrors.push(e.message);
    }
  }

  const sendQuantity = sql<number>`least(${variants.stock}, ${MAX_QUANTITY})`;
  const candidates = await db
    .select({ variantId: variants.id, barcode: variants.barcode, quantity: sendQuantity })
    .from(variants)
    .leftJoin(trendyolStockPush, eq(trendyolStockPush.variantId, variants.id))
    .where(
      and(
        isNotNull(variants.barcode),
        sql`(${trendyolStockPush.variantId} is null
          or ${trendyolStockPush.barcode} <> ${variants.barcode}
          or ${trendyolStockPush.quantity} <> ${sendQuantity}
          or (${trendyolStockPush.status} = 'failed' and ${trendyolStockPush.pushedAt} < ${new Date(now.getTime() - RETRY_FAILED_MS)}))`,
      ),
    )
    .orderBy(asc(variants.id))
    .limit(PUSH_CHUNK * 5);

  let pushed = 0;
  for (let i = 0; i < candidates.length; i += PUSH_CHUNK) {
    const chunk = candidates.slice(i, i + PUSH_CHUNK).map((c) => ({ ...c, barcode: c.barcode!, quantity: Number(c.quantity) }));
    let batchRequestId: string;
    try {
      batchRequestId = await deps.client.updateInventory(chunk.map((c) => ({ barcode: c.barcode, quantity: c.quantity })));
    } catch (e) {
      if (!(e instanceof TrendyolError)) throw e;
      pushErrors.push(e.message);
      // Yetki ya da istek sınırı hatasında kalan parçalar da başarısız olur
      if (e.status === 401 || e.status === 403 || e.status === 429) break;
      continue;
    }
    for (const c of chunk) {
      const values = { barcode: c.barcode, quantity: c.quantity, batchRequestId, status: "pending" as const, error: null, pushedAt: now };
      await db
        .insert(trendyolStockPush)
        .values({ variantId: c.variantId, ...values })
        .onConflictDoUpdate({ target: trendyolStockPush.variantId, set: values });
    }
    pushed += chunk.length;
  }
  return { pushed, pushErrors };
}

/** Gönderilen stokların Trendyol'daki sonucunu işler. */
async function checkPushResults(deps: SyncDeps, now: Date): Promise<number> {
  const batches = await db
    .selectDistinct({ batchRequestId: trendyolStockPush.batchRequestId, pushedAt: trendyolStockPush.pushedAt })
    .from(trendyolStockPush)
    .where(
      and(
        eq(trendyolStockPush.status, "pending"),
        isNotNull(trendyolStockPush.batchRequestId),
        lt(trendyolStockPush.pushedAt, new Date(now.getTime() - BATCH_MIN_AGE_MS)),
      ),
    )
    .orderBy(asc(trendyolStockPush.pushedAt))
    .limit(20);

  const expired = (pushedAt: Date) => now.getTime() - pushedAt.getTime() > BATCH_TTL_MS;
  let checked = 0;
  for (const b of batches) {
    const batchRequestId = b.batchRequestId!;
    const pending = and(eq(trendyolStockPush.batchRequestId, batchRequestId), eq(trendyolStockPush.status, "pending"));
    let results;
    try {
      results = await deps.client.batchResult(batchRequestId);
    } catch (e) {
      if (!(e instanceof TrendyolError)) throw e;
      if (expired(b.pushedAt)) {
        await db.update(trendyolStockPush).set({ status: "failed", error: "Trendyol sonucu alınamadı" }).where(pending);
      }
      continue;
    }
    checked++;
    const byBarcode = new Map(results.map((r) => [r.barcode, r]));
    const rows = await db.select().from(trendyolStockPush).where(pending);
    for (const row of rows) {
      const r = byBarcode.get(row.barcode);
      const done = r?.status === "SUCCESS" || r?.status === "FAILED";
      if (!done && !expired(row.pushedAt)) continue;
      await db
        .update(trendyolStockPush)
        .set(
          r?.status === "SUCCESS"
            ? { status: "ok", error: null }
            : { status: "failed", error: r?.reasons.join("; ").slice(0, 500) || "Trendyol sonucu alınamadı" },
        )
        .where(and(eq(trendyolStockPush.variantId, row.variantId), pending));
    }
  }
  return checked;
}

// ---------- 3. Trendyol satış fiyatı → vitrindeki karşılaştırma ----------

/**
 * Barkodu olan ürünlerin Trendyol satış fiyatını okur; ürünün Trendyol fiyatı, satıştaki barkodlarının en
 * düşüğüdür. Trendyol fiyatı sitedekinden yüksek değilse karşılaştırma kaldırılır (yanıltıcı olmasın) ve
 * panelde uyarı gösterilir. Okunamayan ürünlerde elle girilen değer kalır. Hata stok senkronunu durdurmaz.
 */
async function syncPricesIfDue(deps: SyncDeps, state: SyncState, now: Date) {
  if (state.lastPriceSyncAt && now.getTime() - state.lastPriceSyncAt < PRICE_SYNC_MS) {
    return { updated: null, ranAt: undefined, warnings: undefined, error: undefined };
  }
  const rows = await db
    .select({ productId: products.id, name: products.name, price: products.price, trendyolPrice: products.trendyolPrice, barcode: variants.barcode })
    .from(variants)
    .innerJoin(productColors, eq(productColors.id, variants.colorId))
    .innerJoin(products, eq(products.id, productColors.productId))
    .where(and(isNotNull(variants.barcode), sql`${products.status} <> 'archived'`))
    .limit(10_000);
  const barcodes = [...new Set(rows.map((r) => r.barcode!))];
  const prices = new Map<string, number>();
  try {
    for (let i = 0; i < barcodes.length; i += 50) {
      // Trendyol aynı uca 10 saniyede en fazla 50 istek kabul eder
      if (i > 0) await (deps.pause ?? sleep)(250);
      for (const [b, p] of await deps.client.salePrices(barcodes.slice(i, i + 50))) prices.set(b, p);
    }
  } catch (e) {
    if (!(e instanceof TrendyolError)) throw e;
    return { updated: null, ranAt: undefined, warnings: undefined, error: e.message };
  }

  const byProduct = new Map<string, { name: string; price: number; current: number | null; min: number | null }>();
  for (const r of rows) {
    const entry = byProduct.get(r.productId) ?? { name: r.name, price: r.price, current: r.trendyolPrice, min: null };
    const p = prices.get(r.barcode!);
    if (p !== undefined && (entry.min === null || p < entry.min)) entry.min = p;
    byProduct.set(r.productId, entry);
  }

  let updated = 0;
  const warnings: PriceWarning[] = [];
  for (const [productId, e] of byProduct) {
    if (e.min === null) continue;
    const next = e.min > e.price ? e.min : null;
    if (next === null) warnings.push({ productId, name: e.name, price: e.price, trendyolPrice: e.min });
    if (next === e.current) continue;
    await db.transaction(async (tx) => {
      await tx.update(products).set({ trendyolPrice: next }).where(eq(products.id, productId));
      // Karşılaştırmalı fiyatın kaynağı kayıtlı kalsın
      await audit({ action: "product.trendyol_price", target: productId, data: { from: e.current, to: next, trendyolSalePrice: e.min } }, tx);
    });
    updated++;
  }
  return { updated, ranAt: now.getTime(), warnings: warnings.slice(0, 50), error: undefined };
}

// ---------- Yönetim paneli ----------

export type TrendyolStatus = {
  configured: boolean;
  configError: string | null;
  state: SyncState;
  pendingPushes: number;
  failedPushes: { variantId: string; productId: string; productName: string; colorName: string; size: string; barcode: string; error: string | null; pushedAt: Date }[];
  unmatched: { orderNumber: string; barcode: string; quantity: number }[];
  shortfalls: { orderNumber: string; productId: string; productName: string; colorName: string; size: string; barcode: string; shortfall: number }[];
};

export async function getTrendyolStatus(): Promise<TrendyolStatus> {
  let configured = false;
  let configError: string | null = null;
  try {
    configured = trendyolConfig() !== null;
  } catch (e) {
    configError = e instanceof Error ? e.message : "Trendyol ayarları hatalı";
  }
  const [state, pending, failedPushes, unmatched, shortfalls] = await Promise.all([
    getSyncState(),
    db.select({ n: sql<number>`count(*)::int` }).from(trendyolStockPush).where(eq(trendyolStockPush.status, "pending")),
    db
      .select({
        variantId: trendyolStockPush.variantId,
        productId: products.id,
        productName: products.name,
        colorName: productColors.name,
        size: variants.size,
        barcode: trendyolStockPush.barcode,
        error: trendyolStockPush.error,
        pushedAt: trendyolStockPush.pushedAt,
      })
      .from(trendyolStockPush)
      .innerJoin(variants, eq(variants.id, trendyolStockPush.variantId))
      .innerJoin(productColors, eq(productColors.id, variants.colorId))
      .innerJoin(products, eq(products.id, productColors.productId))
      .where(eq(trendyolStockPush.status, "failed"))
      .orderBy(desc(trendyolStockPush.pushedAt))
      .limit(50),
    db
      .select({ orderNumber: trendyolOrderStock.orderNumber, barcode: trendyolOrderStock.barcode, quantity: trendyolOrderStock.quantity })
      .from(trendyolOrderStock)
      .where(and(isNull(trendyolOrderStock.variantId), sql`${trendyolOrderStock.quantity} > ${trendyolOrderStock.deducted}`))
      .orderBy(desc(trendyolOrderStock.updatedAt))
      .limit(50),
    db
      .select({
        orderNumber: trendyolOrderStock.orderNumber,
        productId: products.id,
        productName: products.name,
        colorName: productColors.name,
        size: variants.size,
        barcode: trendyolOrderStock.barcode,
        shortfall: trendyolOrderStock.shortfall,
      })
      .from(trendyolOrderStock)
      .innerJoin(variants, eq(variants.id, trendyolOrderStock.variantId))
      .innerJoin(productColors, eq(productColors.id, variants.colorId))
      .innerJoin(products, eq(products.id, productColors.productId))
      .where(gt(trendyolOrderStock.shortfall, 0))
      .orderBy(desc(trendyolOrderStock.updatedAt))
      .limit(50),
  ]);
  return { configured, configError, state, pendingPushes: pending[0]?.n ?? 0, failedPushes, unmatched, shortfalls };
}
