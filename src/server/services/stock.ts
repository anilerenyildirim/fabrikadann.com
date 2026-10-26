import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { schema, type DbOrTx, type Tx } from "@/server/db";

const { variants, stockMovements } = schema;

type Reason = (typeof schema.stockReason.enumValues)[number];

type MovementMeta = { reason: Reason; reference?: string | null; actorId?: string | null; note?: string | null };

/**
 * Stoğu yalnızca yeterliyse düşer (tek koşullu UPDATE — eşzamanlı siparişlerde aşırı satış olmaz).
 * Düşebildiyse true.
 */
export async function takeStock(tx: Tx, variantId: string, quantity: number, meta: MovementMeta): Promise<boolean> {
  const updated = await tx
    .update(variants)
    .set({ stock: sql`${variants.stock} - ${quantity}` })
    .where(and(eq(variants.id, variantId), gte(variants.stock, quantity)))
    .returning({ id: variants.id });
  if (updated.length === 0) return false;
  await tx.insert(stockMovements).values({ variantId, delta: -quantity, ...meta });
  return true;
}

export async function returnStock(tx: Tx, variantId: string, quantity: number, meta: MovementMeta): Promise<void> {
  await tx
    .update(variants)
    .set({ stock: sql`${variants.stock} + ${quantity}` })
    .where(eq(variants.id, variantId));
  await tx.insert(stockMovements).values({ variantId, delta: quantity, ...meta });
}

/**
 * Elle stok düzeltmesi: yeni satılabilir değeri yazar, farkı hareket olarak kaydeder.
 * expected verilirse ve stok bu arada değiştiyse (ör. sipariş geldi) yazmaz, StaleStockError fırlatır.
 */
export async function setStock(
  tx: Tx,
  variantId: string,
  newStock: number,
  meta: MovementMeta & { expected?: number },
): Promise<void> {
  if (!Number.isInteger(newStock) || newStock < 0 || newStock > 100000) throw new Error("Geçersiz stok değeri");
  const [current] = await tx
    .select({ stock: variants.stock })
    .from(variants)
    .where(eq(variants.id, variantId))
    .for("update");
  if (!current) throw new Error("Varyant bulunamadı");
  if (meta.expected !== undefined && meta.expected !== current.stock) throw new StaleStockError(current.stock);
  const delta = newStock - current.stock;
  if (delta === 0) return;
  await tx.update(variants).set({ stock: newStock }).where(eq(variants.id, variantId));
  const { expected: _expected, ...movement } = meta;
  await tx.insert(stockMovements).values({ variantId, delta, ...movement });
}

export class StaleStockError extends Error {
  constructor(public current: number) {
    super("Stok bu arada değişti; sayfayı yenileyip tekrar deneyin.");
  }
}

/**
 * Henüz kargolanmamış siparişlerde (Trendyol dahil) ayrılmış adetler (stok sipariş anında düşüldüğü için bunlar
 * `stock` değerine dahil DEĞİL). Fiziksel sayım = stock + reserved.
 */
export async function reservedByVariant(tx: DbOrTx, variantIds?: string[]): Promise<Map<string, number>> {
  const rows = await tx
    .select({ variantId: schema.orderItems.variantId, n: sql<number>`sum(${schema.orderItems.quantity})::int` })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(
      and(
        inArray(schema.orders.status, ["awaiting_payment", "preparing"]),
        variantIds?.length ? inArray(schema.orderItems.variantId, variantIds) : undefined,
      ),
    )
    .groupBy(schema.orderItems.variantId);
  const reserved = new Map(rows.filter((r) => r.variantId).map((r) => [r.variantId!, r.n]));
  for (const [variantId, n] of await trendyolReservedByVariant(tx, variantIds)) {
    reserved.set(variantId, (reserved.get(variantId) ?? 0) + n);
  }
  return reserved;
}

// Henüz kargoya verilmemiş Trendyol paketleri: ürün depoda ama satılmış
const TRENDYOL_UNSHIPPED = ["Awaiting", "Verified", "Created", "Picking", "Invoiced", "Repack"];

/** Kargolanmamış Trendyol siparişleri için stoktan düşülmüş adet (numara başına). */
export async function trendyolReservedByVariant(tx: DbOrTx, variantIds?: string[]): Promise<Map<string, number>> {
  const filter = variantIds?.length ? sql`and s.variant_id in ${variantIds}` : sql``;
  const result = await tx.execute<{ variant_id: string; n: number }>(sql`
    select s.variant_id, sum(least(s.deducted, u.qty))::int as n
    from trendyol_order_stock s
    join (
      select p.order_number, l->>'barcode' as barcode, sum((l->>'quantity')::int) as qty
      from trendyol_packages p, jsonb_array_elements(p.lines) l
      where p.status in ${TRENDYOL_UNSHIPPED}
        and coalesce(l->>'status', '') not in ('Cancelled', 'UnSupplied', 'UnPacked')
      group by 1, 2
    ) u on u.order_number = s.order_number and u.barcode = s.barcode
    where s.variant_id is not null and s.deducted > 0 ${filter}
    group by s.variant_id
  `);
  return new Map(result.rows.map((r) => [r.variant_id, Number(r.n)]));
}

/** Ödemesi beklenen (süresi dolmamış) siparişlerde tutulan adetler. */
export async function unpaidHeldByVariant(tx: DbOrTx, variantIds: string[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await tx
    .select({ variantId: schema.orderItems.variantId, n: sql<number>`sum(${schema.orderItems.quantity})::int` })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(
      and(
        eq(schema.orders.status, "awaiting_payment"),
        sql`${schema.orders.paymentExpiresAt} > now()`,
        inArray(schema.orderItems.variantId, variantIds),
      ),
    )
    .groupBy(schema.orderItems.variantId);
  return new Map(rows.filter((r) => r.variantId).map((r) => [r.variantId!, r.n]));
}

/**
 * Depodaki fiziksel sayımı girer: satılabilir stok = fiziksel − bekleyen siparişlerde ayrılmış adet.
 * Varyant satırı kilitlendikten sonra hesaplanır (eşzamanlı sipariş aynı kilidi bekler).
 */
export async function setPhysicalCount(tx: Tx, variantId: string, physical: number, meta: MovementMeta) {
  if (!Number.isInteger(physical) || physical < 0 || physical > 100000) throw new Error("Geçersiz sayım değeri");
  await tx.select({ id: variants.id }).from(variants).where(eq(variants.id, variantId)).for("update");
  const reserved = (await reservedByVariant(tx, [variantId])).get(variantId) ?? 0;
  const available = Math.max(0, physical - reserved);
  await setStock(tx, variantId, available, meta);
  return { available, reserved, shortfall: Math.max(0, reserved - physical) };
}
