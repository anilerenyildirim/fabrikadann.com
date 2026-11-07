import { and, eq, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/server/db";
import { getSettings } from "@/server/services/settings";
import { enqueueNotification, type NotificationSource } from "./outbox";

type StockLine = { variantId: string; productId: string; label: string; stock: number };

/**
 * Satışla düşen stoğun eşiği geçip geçmediğine bakar; geçtiyse sipariş (referans) başına tek bildirimde toplar.
 * Kural: 0'a indiyse "tükendi"; eşiğin üstünden eşiğe ya da altına indiyse "azaldı".
 */
export async function noteStockDrop(
  tx: Tx,
  input: { variantId: string; before: number; after: number; reference: string; source: NotificationSource },
): Promise<void> {
  const { before, after } = input;
  if (after >= before) return;
  const threshold = (await getSettings(tx)).stockAlertThreshold;
  const out = after <= 0 && before > 0;
  const low = after > 0 && before > threshold && after <= threshold;
  if (!out && !low) return;

  const [v] = await tx
    .select({ size: schema.variants.size, color: schema.productColors.name, product: schema.products.name, productId: schema.products.id })
    .from(schema.variants)
    .innerJoin(schema.productColors, eq(schema.productColors.id, schema.variants.colorId))
    .innerJoin(schema.products, eq(schema.products.id, schema.productColors.productId))
    .where(eq(schema.variants.id, input.variantId));
  if (!v) return;
  const line: StockLine = { variantId: input.variantId, productId: v.productId, label: `${v.product} ${v.color} ${v.size}`, stock: Math.max(after, 0) };

  const dedupeKey = `stock:${input.reference}`;
  const [existing] = await tx
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.dedupeKey, dedupeKey),
        isNull(schema.notifications.sentAt),
        isNull(schema.notifications.claimedAt),
        eq(schema.notifications.attempts, 0),
      ),
    )
    .for("update");
  const previous = ((existing?.data as { lines?: StockLine[] } | null)?.lines ?? []).filter((l) => l.variantId !== line.variantId);
  const lines = [...previous, line];
  const content = render(lines);

  if (existing) {
    await tx.update(schema.notifications).set({ ...content, data: { lines } }).where(eq(schema.notifications.id, existing.id));
  } else if (!(await enqueueNotification(tx, { ...content, source: input.source, dedupeKey, data: { lines } }))) {
    // Bu referansın bildirimi gönderildi ya da gönderiliyor (ör. Trendyol eksiği sonradan düşüldü): ayrı bildirim
    await enqueueNotification(tx, {
      ...render([line]),
      source: input.source,
      dedupeKey: `${dedupeKey}:${line.variantId}:${line.stock}`,
      data: { lines: [line] },
    });
  }
}

function render(lines: StockLine[]) {
  const out = lines.some((l) => l.stock === 0);
  const products = new Set(lines.map((l) => l.productId));
  return {
    kind: out ? ("stock_out" as const) : ("stock_low" as const),
    title: out ? "Stok tükendi" : "Stok azaldı",
    body: lines.map((l) => `${l.label}: ${l.stock}`).join(" · ").slice(0, 200),
    url: products.size === 1 ? `/yonetim/urunler/${lines[0]!.productId}` : "/yonetim/stok",
  };
}
