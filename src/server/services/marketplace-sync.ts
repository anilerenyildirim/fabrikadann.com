import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, pool, schema, type Tx } from "@/server/db";
import type { MarketplaceLine } from "@/server/db/schema";
import { describeError } from "@/server/log";
import { N11Error, n11Config, type N11Client, type N11Package } from "@/server/marketplaces/n11/client";
import { n11PriceOf } from "@/server/marketplaces/n11/listing";
import { enqueueNotification } from "@/server/notifications/outbox";
import { noteStockDrop } from "@/server/notifications/stock-alert";
import { getSettings } from "./settings";
import { returnStock } from "./stock";

/**
 * N11 ile ortak stok (Trendyol senkronuyla aynı kurallar, kanal bazlı tablolarda). Kaynak `variants.stock`:
 * 1. Son güncellenen N11 paketleri çekilir; her sipariş + stok kodu için düşülmesi gereken adet paket
 *    durumlarından yeniden hesaplanır, fark kadar düşülür ya da geri konur (idempotent).
 * 2. Stoğu tam düşülen yeni siparişler N11'de onaylanır (Created → Picking).
 * 3. Ürün yükleme / fiyat-stok görevlerinin sonucu okunur.
 * 4. N11'deki numaraların satılabilir stoğu ve N11 fiyatı, değiştiyse gönderilir.
 * Zamanlanmış görev: npm run marketplace:sync (2 dakikada bir).
 */

const CHANNEL = "n11";
const { marketplacePackages, marketplaceOrderStock, marketplaceListings, marketplaceTasks, marketplaceSyncState, variants, productColors, products, stockMovements } =
  schema;

const STATUSES = ["Created", "Picking", "Shipped", "Delivered", "Cancelled", "UnSupplied", "UnPacked"];
// Bu durumlardaki paket stok tutmaz (iptal, tedarik edilemedi, bölünüp satırları yeni paketlere taşındı)
const RELEASED = new Set(["Cancelled", "UnSupplied", "UnPacked"]);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// N11 tarihleri GMT+3'e göre yorumlayabiliyor; pencere iki yönde geniş, işleme idempotent
const OVERLAP_MS = 4 * HOUR;
const FUTURE_MS = 4 * HOUR;
// N11 en fazla 1 aylık aralık döner
const MAX_LOOKBACK_MS = 29 * 24 * HOUR;
const MAX_PAGES = 20;
const PUSH_CHUNK = 1000;
const RETRY_FAILED_MS = 15 * MINUTE;
const TASK_MIN_AGE_MS = 30_000;
const TASK_TTL_MS = 24 * HOUR;

export type N11SyncApi = Pick<N11Client, "shipmentPackages" | "approveLines" | "updatePriceStock" | "taskDetails">;

export type N11SyncSummary = {
  baseline: boolean;
  packages: number;
  skippedPackages: number;
  orders: number;
  deducted: number;
  returned: number;
  shortfall: number;
  approved: number;
  tasksChecked: number;
  pushed: number;
  pushErrors: string[];
};

type SyncState = {
  cursor?: number;
  baselineAt?: number;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastError?: string | null;
  lastSummary?: N11SyncSummary;
};

async function getState(): Promise<SyncState> {
  const [row] = await db.select().from(marketplaceSyncState).where(eq(marketplaceSyncState.channel, CHANNEL));
  return (row?.state as SyncState | undefined) ?? {};
}

async function saveState(state: SyncState) {
  await db
    .insert(marketplaceSyncState)
    .values({ channel: CHANNEL, state })
    .onConflictDoUpdate({ target: marketplaceSyncState.channel, set: { state } });
}

/** Tek çalıştırma; aynı anda ikinci çalıştırma varsa null döner. Hata durum kaydına yazılır ve fırlatılır. */
export async function runN11Sync(deps: { client: N11SyncApi; now?: () => Date }): Promise<N11SyncSummary | null> {
  const lock = await pool.connect();
  try {
    const { rows } = await lock.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtext('n11-sync')) as ok");
    if (!rows[0]?.ok) return null;
    try {
      return await runLocked(deps.client, (deps.now ?? (() => new Date()))());
    } finally {
      await lock.query("select pg_advisory_unlock(hashtext('n11-sync'))");
    }
  } finally {
    lock.release();
  }
}

async function runLocked(client: N11SyncApi, now: Date): Promise<N11SyncSummary> {
  const state = await getState();
  const runAt = now.toISOString();
  try {
    const pulled = await pullOrders(client, state, now);
    const approved = await approveReadyOrders(client);
    const tasksChecked = await checkTasks(client, now);
    const push = await pushStock(client, now);
    const summary: N11SyncSummary = { ...pulled, approved, tasksChecked, ...push };
    await saveState({
      cursor: now.getTime(),
      baselineAt: state.baselineAt ?? (pulled.baseline ? now.getTime() : undefined),
      lastRunAt: runAt,
      lastSuccessAt: push.pushErrors.length ? state.lastSuccessAt : runAt,
      lastError: push.pushErrors.length ? `Stok gönderimi: ${push.pushErrors[0]}` : null,
      lastSummary: summary,
    });
    return summary;
  } catch (e) {
    const message = e instanceof N11Error ? e.message : describeError(e).split("\n")[0]!;
    // Çekim başarısızsa imleç ilerlemez; sonraki çalıştırma aynı pencereyi yeniden dener
    await saveState({ ...state, lastRunAt: runAt, lastError: message });
    throw e;
  }
}

// ---------- 1. Siparişler → stok ----------

async function pullOrders(client: N11SyncApi, state: SyncState, now: Date) {
  const baseline = state.cursor === undefined;
  const floor = now.getTime() - MAX_LOOKBACK_MS;
  const start = baseline ? floor : Math.max(state.cursor! - OVERLAP_MS, floor);
  const end = now.getTime() + FUTURE_MS;
  const baselineAt = state.baselineAt ?? (baseline ? now.getTime() : undefined);

  const seen = new Map<string, N11Package>();
  let skippedPackages = 0;
  for (const status of STATUSES) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await client.shipmentPackages({ start, end, status, page });
      skippedPackages += res.skipped;
      for (const p of res.packages) seen.set(p.id, p);
      if (page + 1 >= res.totalPages || res.packages.length === 0) break;
    }
  }

  const orderNumbers = new Set<string>();
  for (const p of seen.values()) if (await savePackage(p)) orderNumbers.add(p.orderNumber);
  // Stok yetmeyen satırlar ve stok kodu sonradan bir numaraya yazılmış eşleşmeyen satırlar yeniden denenir
  const open = await db
    .select({ orderNumber: marketplaceOrderStock.orderNumber })
    .from(marketplaceOrderStock)
    .where(
      and(
        eq(marketplaceOrderStock.channel, CHANNEL),
        sql`${marketplaceOrderStock.quantity} > ${marketplaceOrderStock.deducted} and (${marketplaceOrderStock.variantId} is not null
          or exists (select 1 from ${variants} where ${variants.sku} = ${marketplaceOrderStock.stockCode}))`,
      ),
    )
    .orderBy(asc(marketplaceOrderStock.updatedAt))
    .limit(500);
  for (const o of open) orderNumbers.add(o.orderNumber);

  let deducted = 0;
  let returned = 0;
  let shortfall = 0;
  for (const orderNumber of orderNumbers) {
    const r = await applyOrder(orderNumber, baselineAt, baseline);
    deducted += r.deducted;
    returned += r.returned;
    shortfall += r.shortfall;
  }
  return { baseline, packages: seen.size, skippedPackages, orders: orderNumbers.size, deducted, returned, shortfall };
}

async function savePackage(p: N11Package): Promise<boolean> {
  const rows = await db
    .insert(marketplacePackages)
    .values({ channel: CHANNEL, id: p.id, orderNumber: p.orderNumber, status: p.status, lines: p.lines, orderDate: p.orderDate, lastModifiedAt: p.lastModifiedAt })
    .onConflictDoUpdate({
      target: [marketplacePackages.channel, marketplacePackages.id],
      set: {
        orderNumber: p.orderNumber,
        status: p.status,
        lines: p.lines,
        orderDate: sql`coalesce(excluded.order_date, ${marketplacePackages.orderDate})`,
        lastModifiedAt: p.lastModifiedAt,
      },
      setWhere: sql`${marketplacePackages.lastModifiedAt} is null or excluded.last_modified_at is null
        or excluded.last_modified_at >= ${marketplacePackages.lastModifiedAt}`,
    })
    .returning({ id: marketplacePackages.id });
  return rows.length > 0;
}

function wantedByStockCode(packages: { status: string; lines: MarketplaceLine[] }[]) {
  const wanted = new Map<string, number>();
  for (const p of packages) {
    if (RELEASED.has(p.status)) continue;
    for (const l of p.lines) {
      if (RELEASED.has(l.status) || l.quantity <= 0) continue;
      wanted.set(l.stockCode, (wanted.get(l.stockCode) ?? 0) + l.quantity);
    }
  }
  return wanted;
}

async function matchVariant(tx: Tx, stockCode: string): Promise<string | null> {
  const [v] = await tx.select({ id: variants.id }).from(variants).where(eq(variants.sku, stockCode)).limit(1);
  return v?.id ?? null;
}

/** Yettiği kadar düşer (N11'de satış zaten oldu); düşülen adedi döner. */
async function takeAvailable(tx: Tx, variantId: string, quantity: number, reference: string): Promise<number> {
  const [v] = await tx.select({ stock: variants.stock }).from(variants).where(eq(variants.id, variantId)).for("update");
  const taken = Math.min(v?.stock ?? 0, quantity);
  if (taken > 0) {
    await tx.update(variants).set({ stock: sql`${variants.stock} - ${taken}` }).where(eq(variants.id, variantId));
    await tx.insert(stockMovements).values({
      variantId,
      delta: -taken,
      reason: "n11",
      reference,
      note: taken < quantity ? `N11 satışı; ${quantity - taken} adet için stok yoktu` : "N11 satışı",
    });
    await noteStockDrop(tx, { variantId, before: v!.stock, after: v!.stock - taken, reference, source: "n11" });
  }
  return taken;
}

/**
 * Bir N11 siparişinin stok etkisini paketlerle eşitler. Senkron açılmadan önce verilmiş siparişler ilk
 * görüldüklerinde stok değiştirilmeden "zaten düşülmüş" kabul edilir.
 */
async function applyOrder(orderNumber: string, baselineAt: number | undefined, baselineRun: boolean) {
  return db.transaction(async (tx) => {
    const result = { deducted: 0, returned: 0, shortfall: 0 };
    const packages = await tx
      .select({ status: marketplacePackages.status, lines: marketplacePackages.lines, orderDate: marketplacePackages.orderDate })
      .from(marketplacePackages)
      .where(and(eq(marketplacePackages.channel, CHANNEL), eq(marketplacePackages.orderNumber, orderNumber)));
    const wanted = wantedByStockCode(packages);
    const dates = packages.map((p) => p.orderDate?.getTime()).filter((d): d is number => d !== undefined);
    const orderedAt = dates.length ? Math.min(...dates) : undefined;
    const preexisting = orderedAt !== undefined && baselineAt !== undefined ? orderedAt < baselineAt : baselineRun;

    const where = and(eq(marketplaceOrderStock.channel, CHANNEL), eq(marketplaceOrderStock.orderNumber, orderNumber));
    // Kilit sırası: önce numaralar (kimlik sırasıyla), sonra sipariş kayıtları — ödeme akışıyla aynı
    const preview = await tx.select().from(marketplaceOrderStock).where(where);
    const lockIds = new Set<string>();
    for (const r of preview) if (r.variantId) lockIds.add(r.variantId);
    for (const code of wanted.keys()) {
      if (preview.some((r) => r.stockCode === code && r.variantId)) continue;
      const v = await matchVariant(tx, code);
      if (v) lockIds.add(v);
    }
    if (lockIds.size) {
      await tx.select({ id: variants.id }).from(variants).where(inArray(variants.id, [...lockIds])).orderBy(asc(variants.id)).for("update");
    }
    const existing = await tx.select().from(marketplaceOrderStock).where(where).for("update");
    const rows = new Map(existing.map((r) => [r.stockCode, r]));

    const entries = [];
    for (const code of new Set([...wanted.keys(), ...rows.keys()])) {
      const want = wanted.get(code) ?? 0;
      const row = rows.get(code);
      if (!row && want === 0) continue;
      entries.push({ code, want, row, variantId: row?.variantId ?? (await matchVariant(tx, code)) });
    }
    entries.sort((x, y) => (x.variantId ?? "~").localeCompare(y.variantId ?? "~"));

    const reference = `N11 ${orderNumber}`;
    let orderShort = 0;
    for (const { code, want, row, variantId } of entries) {
      let deducted = row?.deducted ?? 0;
      if (!row && preexisting) {
        deducted = want;
      } else if (variantId && want > deducted) {
        const taken = await takeAvailable(tx, variantId, want - deducted, reference);
        deducted += taken;
        result.deducted += taken;
      } else if (variantId && want < deducted) {
        const back = deducted - want;
        await returnStock(tx, variantId, back, { reason: "n11", reference, note: "N11 iptali" });
        deducted = want;
        result.returned += back;
      } else if (!variantId) {
        deducted = Math.min(deducted, want);
      }
      const short = variantId ? want - deducted : 0;
      orderShort += short;
      if (short > (row?.shortfall ?? 0)) result.shortfall += short - (row?.shortfall ?? 0);
      const values = { variantId, quantity: want, deducted, shortfall: short };
      if (row) {
        await tx.update(marketplaceOrderStock).set(values).where(and(where, eq(marketplaceOrderStock.stockCode, code)));
      } else {
        await tx.insert(marketplaceOrderStock).values({ channel: CHANNEL, orderNumber, stockCode: code, ...values });
      }
    }

    if (existing.length === 0 && !preexisting && wanted.size > 0) {
      const count = [...wanted.values()].reduce((n, q) => n + q, 0);
      await enqueueNotification(tx, {
        kind: "order_new",
        source: "n11",
        title: `N11 siparişi ${orderNumber}`,
        body: `${count} ürün${orderShort > 0 ? ` · ${orderShort} adet için sitede stok yoktu` : ""}`,
        url: "/yonetim/stok",
        dedupeKey: `n11:order:${orderNumber}`,
      });
    }
    // Muhasebe: satışın maliyeti ve üreticisi ilk eşleşmede sabitlenir
    await tx.execute(sql`
      update marketplace_order_stock s
      set unit_cost = ps.purchase_price, manufacturer_id = ps.manufacturer_id, cost_fixed_at = now()
      from variants v
      join product_colors c on c.id = v.color_id
      join product_supply ps on ps.product_id = c.product_id
      where s.channel = ${CHANNEL} and s.order_number = ${orderNumber} and s.variant_id = v.id and s.cost_fixed_at is null
    `);
    return result;
  });
}

// ---------- 2. Otomatik onay ----------

/** Stoğu tam düşülmüş, eşleşmeyen satırı olmayan yeni (Created) paketleri N11'de onaylar. */
async function approveReadyOrders(client: N11SyncApi): Promise<number> {
  const created = await db
    .select()
    .from(marketplacePackages)
    .where(and(eq(marketplacePackages.channel, CHANNEL), eq(marketplacePackages.status, "Created")))
    .limit(200);
  if (created.length === 0) return 0;
  const orders = [...new Set(created.map((p) => p.orderNumber))];
  const stock = await db
    .select()
    .from(marketplaceOrderStock)
    .where(and(eq(marketplaceOrderStock.channel, CHANNEL), inArray(marketplaceOrderStock.orderNumber, orders)));
  const ready = new Set(
    orders.filter((o) => {
      const rows = stock.filter((s) => s.orderNumber === o);
      return rows.length > 0 && rows.every((s) => s.variantId && s.deducted >= s.quantity && s.shortfall === 0);
    }),
  );
  const packages = created.filter((p) => ready.has(p.orderNumber));
  const lineIds = packages.flatMap((p) => p.lines.filter((l) => !RELEASED.has(l.status)).map((l) => l.lineId));
  let approved = 0;
  for (let i = 0; i < lineIds.length; i += 100) {
    let results;
    try {
      results = await client.approveLines(lineIds.slice(i, i + 100));
    } catch (e) {
      if (!(e instanceof N11Error)) throw e;
      break;
    }
    const ok = new Set(results.filter((r) => r.ok).map((r) => r.lineId));
    approved += ok.size;
    // Tüm satırları onaylanan paket yerelde Picking sayılır (bir sonraki çekim gerçek durumu yazar)
    for (const p of packages) {
      if (p.lines.every((l) => ok.has(l.lineId) || RELEASED.has(l.status))) {
        await db
          .update(marketplacePackages)
          .set({ status: "Picking" })
          .where(and(eq(marketplacePackages.channel, CHANNEL), eq(marketplacePackages.id, p.id), eq(marketplacePackages.status, "Created")));
      }
    }
  }
  return approved;
}

// ---------- 3. Görev sonuçları ----------

async function checkTasks(client: N11SyncApi, now: Date): Promise<number> {
  const open = await db
    .select()
    .from(marketplaceTasks)
    .where(
      and(eq(marketplaceTasks.channel, CHANNEL), eq(marketplaceTasks.done, false), lt(marketplaceTasks.createdAt, new Date(now.getTime() - TASK_MIN_AGE_MS))),
    )
    .orderBy(asc(marketplaceTasks.createdAt))
    .limit(20);
  let checked = 0;
  for (const t of open) {
    const expired = now.getTime() - t.createdAt.getTime() > TASK_TTL_MS;
    let details: Awaited<ReturnType<N11SyncApi["taskDetails"]>> | null = null;
    try {
      details = await client.taskDetails(t.taskId);
    } catch (e) {
      if (!(e instanceof N11Error)) throw e;
    }
    const status = details?.status.toUpperCase() ?? "";
    const finished = status === "PROCESSED" || status === "REJECT";
    if (!finished && !expired) {
      await db.update(marketplaceTasks).set({ checkedAt: now }).where(and(eq(marketplaceTasks.channel, CHANNEL), eq(marketplaceTasks.taskId, t.taskId)));
      continue;
    }
    checked++;
    const results = new Map((details?.skus ?? []).map((s) => [s.stockCode, s]));
    const fallback = status === "REJECT" ? "N11 görevi reddetti" : "N11 sonucu alınamadı";
    await db.transaction(async (tx) => {
      if (t.kind === "create") {
        const rows = await tx
          .select({ stockCode: marketplaceListings.stockCode })
          .from(marketplaceListings)
          .where(and(eq(marketplaceListings.channel, CHANNEL), eq(marketplaceListings.taskId, t.taskId), eq(marketplaceListings.status, "pending")));
        for (const r of rows) {
          const res = results.get(r.stockCode);
          await tx
            .update(marketplaceListings)
            .set(
              res?.ok
                ? // Yüklemede gönderilen adet o anki stoktu: güncel stok ve fiyat sonraki adımda yeniden gönderilir
                  { status: "active", error: null, pushedQuantity: null, pushedPrice: null, pushError: null }
                : { status: "failed", error: (res?.reasons.join("; ") || fallback).slice(0, 500) },
            )
            .where(and(eq(marketplaceListings.channel, CHANNEL), eq(marketplaceListings.stockCode, r.stockCode)));
        }
      } else {
        const rows = await tx
          .select({ stockCode: marketplaceListings.stockCode })
          .from(marketplaceListings)
          .where(and(eq(marketplaceListings.channel, CHANNEL), eq(marketplaceListings.pushTaskId, t.taskId)));
        for (const r of rows) {
          const res = results.get(r.stockCode);
          await tx
            .update(marketplaceListings)
            .set(res?.ok ? { pushError: null } : { pushError: (res?.reasons.join("; ") || fallback).slice(0, 500), pushedQuantity: null, pushedPrice: null })
            .where(and(eq(marketplaceListings.channel, CHANNEL), eq(marketplaceListings.stockCode, r.stockCode)));
        }
      }
      await tx.update(marketplaceTasks).set({ done: true, checkedAt: now }).where(and(eq(marketplaceTasks.channel, CHANNEL), eq(marketplaceTasks.taskId, t.taskId)));
    });
  }
  return checked;
}

// ---------- 4. Stok ve fiyat → N11 ----------

async function pushStock(client: N11SyncApi, now: Date) {
  const settings = await getSettings();
  const rows = await db
    .select({
      stockCode: marketplaceListings.stockCode,
      variantId: marketplaceListings.variantId,
      pushedQuantity: marketplaceListings.pushedQuantity,
      pushedPrice: marketplaceListings.pushedPrice,
      pushError: marketplaceListings.pushError,
      pushedAt: marketplaceListings.pushedAt,
      stock: variants.stock,
      productStatus: products.status,
      price: products.price,
      n11Price: products.n11Price,
    })
    .from(marketplaceListings)
    .leftJoin(variants, eq(variants.id, marketplaceListings.variantId))
    .leftJoin(productColors, eq(productColors.id, variants.colorId))
    .leftJoin(products, eq(products.id, productColors.productId))
    .where(and(eq(marketplaceListings.channel, CHANNEL), eq(marketplaceListings.status, "active")))
    .orderBy(asc(marketplaceListings.stockCode));

  const retryDue = (r: { pushError: string | null; pushedAt: Date | null }) =>
    !r.pushError || !r.pushedAt || now.getTime() - r.pushedAt.getTime() >= RETRY_FAILED_MS;
  const items: { stockCode: string; quantity: number; price?: number }[] = [];
  for (const r of rows) {
    if (!retryDue(r)) continue;
    if (r.variantId === null || r.price === null) {
      // Numara silindi: N11'de eski stokla satışta kalmasın
      if (r.pushedQuantity !== 0) items.push({ stockCode: r.stockCode, quantity: 0 });
      continue;
    }
    const quantity = r.productStatus === "active" ? Math.min(Math.max(r.stock ?? 0, 0), 999999) : 0;
    const price = n11PriceOf(r.price, r.n11Price, settings.n11PricePercent);
    if (quantity !== r.pushedQuantity || price !== r.pushedPrice) items.push({ stockCode: r.stockCode, quantity, price });
  }

  const pushErrors: string[] = [];
  let pushed = 0;
  for (let i = 0; i < items.length; i += PUSH_CHUNK) {
    const chunk = items.slice(i, i + PUSH_CHUNK);
    let task;
    try {
      task = await client.updatePriceStock(chunk);
    } catch (e) {
      if (!(e instanceof N11Error)) throw e;
      pushErrors.push(e.message);
      if (e.status === 401 || e.status === 403 || e.status === 429) break;
      continue;
    }
    const rejected = !task.taskId || task.status.toUpperCase() === "REJECT";
    if (rejected) pushErrors.push(task.reasons.join("; ") || "N11 isteği reddetti");
    await db.transaction(async (tx) => {
      for (const c of chunk) {
        await tx
          .update(marketplaceListings)
          .set(
            rejected
              ? { pushError: (task.reasons.join("; ") || "N11 isteği reddetti").slice(0, 500), pushedAt: now }
              : { pushedQuantity: c.quantity, pushedPrice: c.price ?? null, pushTaskId: task.taskId, pushedAt: now, pushError: null },
          )
          .where(and(eq(marketplaceListings.channel, CHANNEL), eq(marketplaceListings.stockCode, c.stockCode)));
      }
      if (!rejected) await tx.insert(marketplaceTasks).values({ channel: CHANNEL, taskId: task.taskId!, kind: "price_stock" }).onConflictDoNothing();
    });
    if (!rejected) pushed += chunk.length;
  }
  return { pushed, pushErrors };
}

// ---------- Yönetim paneli ----------

export async function getN11Status() {
  let configured = false;
  let configError: string | null = null;
  try {
    configured = n11Config() !== null;
  } catch (e) {
    configError = e instanceof Error ? e.message : "N11 ayarları hatalı";
  }
  const [state, counts, failed, shortfalls, unmatched] = await Promise.all([
    getState(),
    db
      .select({ status: marketplaceListings.status, n: sql<number>`count(*)::int` })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.channel, CHANNEL))
      .groupBy(marketplaceListings.status),
    db
      .select({
        stockCode: marketplaceListings.stockCode,
        productId: marketplaceListings.productId,
        productName: products.name,
        error: marketplaceListings.error,
        pushError: marketplaceListings.pushError,
      })
      .from(marketplaceListings)
      .leftJoin(products, eq(products.id, marketplaceListings.productId))
      .where(
        and(
          eq(marketplaceListings.channel, CHANNEL),
          sql`(${marketplaceListings.status} = 'failed' or ${marketplaceListings.pushError} is not null)`,
        ),
      )
      .orderBy(desc(marketplaceListings.updatedAt))
      .limit(50),
    db
      .select({
        orderNumber: marketplaceOrderStock.orderNumber,
        stockCode: marketplaceOrderStock.stockCode,
        productId: products.id,
        productName: products.name,
        colorName: productColors.name,
        size: variants.size,
        shortfall: marketplaceOrderStock.shortfall,
      })
      .from(marketplaceOrderStock)
      .innerJoin(variants, eq(variants.id, marketplaceOrderStock.variantId))
      .innerJoin(productColors, eq(productColors.id, variants.colorId))
      .innerJoin(products, eq(products.id, productColors.productId))
      .where(and(eq(marketplaceOrderStock.channel, CHANNEL), sql`${marketplaceOrderStock.shortfall} > 0`))
      .orderBy(desc(marketplaceOrderStock.updatedAt))
      .limit(50),
    db
      .select({ orderNumber: marketplaceOrderStock.orderNumber, stockCode: marketplaceOrderStock.stockCode, quantity: marketplaceOrderStock.quantity })
      .from(marketplaceOrderStock)
      .where(
        and(
          eq(marketplaceOrderStock.channel, CHANNEL),
          isNull(marketplaceOrderStock.variantId),
          sql`${marketplaceOrderStock.quantity} > ${marketplaceOrderStock.deducted}`,
        ),
      )
      .orderBy(desc(marketplaceOrderStock.updatedAt))
      .limit(50),
  ]);
  const by = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  return {
    configured,
    configError,
    state,
    listings: { pending: by("pending"), active: by("active"), failed: by("failed") },
    failed,
    shortfalls,
    unmatched,
  };
}
