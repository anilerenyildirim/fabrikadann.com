import { and, eq, gte, sql } from "drizzle-orm";
import { schema, type Tx } from "@/server/db";

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

/** Elle stok düzeltmesi: yeni değeri yazar, farkı hareket olarak kaydeder. */
export async function setStock(tx: Tx, variantId: string, newStock: number, meta: MovementMeta): Promise<void> {
  if (!Number.isInteger(newStock) || newStock < 0 || newStock > 100000) throw new Error("Geçersiz stok değeri");
  const [current] = await tx
    .select({ stock: variants.stock })
    .from(variants)
    .where(eq(variants.id, variantId))
    .for("update");
  if (!current) throw new Error("Varyant bulunamadı");
  const delta = newStock - current.stock;
  if (delta === 0) return;
  await tx.update(variants).set({ stock: newStock }).where(eq(variants.id, variantId));
  await tx.insert(stockMovements).values({ variantId, delta, ...meta });
}
