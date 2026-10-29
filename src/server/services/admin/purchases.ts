import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { audit } from "../audit";
import { compareSizes } from "../catalog";
import { returnStock, takeStock } from "../stock";
import { AdminError, assertAdmin, type AdminContext } from "./context";
import { assertManufacturer, MAX_AMOUNT_KURUS, parseManufacturerId } from "./manufacturers";

const { purchases, purchaseItems, variants, productColors, products, productSupply, manufacturers } = schema;

export type PurchaseKind = (typeof schema.purchaseKind.enumValues)[number];

export const PURCHASE_KIND_LABELS: Record<PurchaseKind, string> = {
  purchase: "Mal alımı",
  return: "Üreticiye iade",
};

export const MAX_PURCHASE_LINES = 500;
export const MAX_LINE_QUANTITY = 10_000;

/** "YYYY-MM-DD"; 2020'den önce ya da yarından sonra olamaz. */
export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarihi gün.ay.yıl olarak seçin.")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Geçerli bir tarih seçin.")
  .refine((v) => v >= "2020-01-01", "Tarih 2020'den önce olamaz.")
  .refine((v) => v <= istanbulDate(new Date(Date.now() + 86_400_000)), "İleri tarihli kayıt girilemez.");

/** Bir anın İstanbul'daki takvim günü, "YYYY-MM-DD". */
export function istanbulDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(d);
}

export const purchaseInputSchema = z.object({
  kind: z.enum(["purchase", "return"], { error: "Fiş türünü seçin." }),
  manufacturerId: z.uuid("Üretici seçin."),
  date: businessDateSchema,
  note: z.string().trim().max(500, "Not en fazla 500 karakter olabilir.").default(""),
  lines: z
    .array(
      z.object({
        variantId: z.uuid("Satırdaki numara bulunamadı. Sayfayı yenileyin."),
        quantity: z
          .number({ error: "Adet için tam sayı yazın." })
          .int("Adet için tam sayı yazın.")
          .min(1, "Adet en az 1 olmalı.")
          .max(MAX_LINE_QUANTITY, `Bir satırda en fazla ${MAX_LINE_QUANTITY} adet olabilir.`),
        unitCost: z
          .number({ error: "Birim maliyeti 850,00 biçiminde yazın." })
          .int("Birim maliyeti 850,00 biçiminde yazın.")
          .min(0, "Birim maliyet 0'dan küçük olamaz.")
          .max(MAX_AMOUNT_KURUS / 10, "Birim maliyet çok büyük."),
      }),
    )
    .min(1, "En az bir numara için adet girin.")
    .max(MAX_PURCHASE_LINES, `Bir fişte en fazla ${MAX_PURCHASE_LINES} satır olabilir.`),
});

export type PurchaseInput = z.input<typeof purchaseInputSchema>;

export function purchaseRef(number: number, kind: PurchaseKind) {
  return `${kind === "purchase" ? "AL" : "IA"}-${number}`;
}

/**
 * Alış fişi stoğu artırır ve üreticiye borç yazar; iade fişi stoğu düşer ve borcu azaltır.
 * Fişteki her numara bu üreticinin ürünü olmalı. Fiş sonradan silinmez ya da değiştirilmez.
 */
export async function createPurchase(raw: PurchaseInput, ctx: AdminContext): Promise<{ id: string; number: number }> {
  await assertAdmin(ctx);
  const r = purchaseInputSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue?.path[0] === "lines" ? "lines" : (issue?.path.join(".") ?? undefined);
    throw new AdminError(issue?.message ?? "Geçersiz değer.", field);
  }
  const input = r.data;
  const ids = input.lines.map((l) => l.variantId);
  if (new Set(ids).size !== ids.length) throw new AdminError("Aynı numara fişte iki kez var; adetleri tek satırda toplayın.", "lines");

  return db.transaction(async (tx) => {
    const manufacturer = await assertManufacturer(input.manufacturerId, tx);
    if (input.kind === "purchase" && !manufacturer.active) {
      throw new AdminError("Pasif üreticiden mal alımı girilemez. Önce üreticiyi etkinleştirin.", "manufacturerId");
    }
    const rows = await tx
      .select({
        variantId: variants.id,
        size: variants.size,
        productionBarcode: variants.productionBarcode,
        colorName: productColors.name,
        productId: products.id,
        productName: products.name,
        manufacturerId: productSupply.manufacturerId,
        purchasePrice: productSupply.purchasePrice,
      })
      .from(variants)
      .innerJoin(productColors, eq(productColors.id, variants.colorId))
      .innerJoin(products, eq(products.id, productColors.productId))
      .leftJoin(productSupply, eq(productSupply.productId, products.id))
      .where(inArray(variants.id, ids));
    const byId = new Map(rows.map((row) => [row.variantId, row]));
    for (const l of input.lines) {
      const v = byId.get(l.variantId);
      if (!v) throw new AdminError("Fişteki bir numara silinmiş. Sayfayı yenileyip yeniden girin.", "lines");
      if (v.manufacturerId !== input.manufacturerId) {
        throw new AdminError(`${v.productName} (${v.size}) bu üreticinin ürünü değil. Ürünün üreticisini kontrol edin.`, "lines");
      }
    }

    const total = input.lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0);
    if (total > MAX_AMOUNT_KURUS) throw new AdminError("Fiş toplamı çok büyük; fişi bölün.", "lines");

    const [purchase] = await tx
      .insert(purchases)
      .values({
        kind: input.kind,
        manufacturerId: input.manufacturerId,
        date: input.date,
        note: input.note,
        total,
        actorId: ctx.actorId,
      })
      .returning({ id: purchases.id, number: purchases.number });
    const ref = purchaseRef(purchase!.number, input.kind);

    // Kilit sırası sabit (eşzamanlı sipariş ve sayımlarla kilitlenme olmasın)
    const sorted = [...input.lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
    const short: string[] = [];
    for (const l of sorted) {
      const meta = { reference: ref, actorId: ctx.actorId, note: input.note || null };
      if (input.kind === "purchase") {
        await returnStock(tx, l.variantId, l.quantity, { ...meta, reason: "purchase" });
      } else if (!(await takeStock(tx, l.variantId, l.quantity, { ...meta, reason: "supplier_return" }))) {
        const v = byId.get(l.variantId)!;
        short.push(`${v.productName} ${v.colorName} ${v.size}`);
      }
    }
    if (short.length) {
      throw new AdminError(`Stokta yeterli adet yok: ${short.join(", ")}. İade adedini satılabilir stoğa göre girin.`, "lines");
    }

    await tx.insert(purchaseItems).values(
      input.lines.map((l) => {
        const v = byId.get(l.variantId)!;
        return {
          purchaseId: purchase!.id,
          variantId: v.variantId,
          productId: v.productId,
          productName: v.productName,
          colorName: v.colorName,
          size: v.size,
          productionBarcode: v.productionBarcode,
          quantity: l.quantity,
          unitCost: l.unitCost,
        };
      }),
    );

    // Alış fiyatı girilmemiş ürüne ilk alımın maliyeti yazılır
    if (input.kind === "purchase") {
      const firstCost = new Map<string, number>();
      for (const l of input.lines) {
        const v = byId.get(l.variantId)!;
        if (v.purchasePrice === null && !firstCost.has(v.productId)) firstCost.set(v.productId, l.unitCost);
      }
      for (const [productId, cost] of firstCost) {
        await tx
          .update(productSupply)
          .set({ purchasePrice: cost })
          .where(and(eq(productSupply.productId, productId), isNull(productSupply.purchasePrice)));
      }
    }

    await audit(
      {
        action: input.kind === "purchase" ? "purchase.create" : "purchase.return",
        actorId: ctx.actorId,
        target: purchase!.id,
        data: {
          number: purchase!.number,
          manufacturerId: input.manufacturerId,
          date: input.date,
          total,
          lines: input.lines.length,
          pairs: input.lines.reduce((n, l) => n + l.quantity, 0),
        },
        ip: ctx.ip,
      },
      tx,
    );
    return purchase!;
  });
}

const PAGE_SIZE = 50;

export async function listPurchases(input: { manufacturerId?: string; page?: number } = {}) {
  const where = input.manufacturerId && z.uuid().safeParse(input.manufacturerId).success
    ? eq(purchases.manufacturerId, input.manufacturerId)
    : undefined;
  const page = Math.max(1, input.page ?? 1);
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: purchases.id,
        number: purchases.number,
        kind: purchases.kind,
        date: purchases.date,
        total: purchases.total,
        note: purchases.note,
        manufacturerId: purchases.manufacturerId,
        manufacturerName: manufacturers.name,
        pairs: sql<number>`(select coalesce(sum(quantity), 0)::int from purchase_items where purchase_id = ${purchases.id})`,
      })
      .from(purchases)
      .innerJoin(manufacturers, eq(manufacturers.id, purchases.manufacturerId))
      .where(where)
      .orderBy(desc(purchases.date), desc(purchases.number))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(purchases).where(where),
  ]);
  return { rows, total: total?.n ?? 0, page, pageCount: Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE)) };
}

export async function getPurchase(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [purchase] = await db
    .select({
      id: purchases.id,
      number: purchases.number,
      kind: purchases.kind,
      date: purchases.date,
      total: purchases.total,
      note: purchases.note,
      createdAt: purchases.createdAt,
      manufacturerId: purchases.manufacturerId,
      manufacturerName: manufacturers.name,
      actorEmail: schema.users.email,
    })
    .from(purchases)
    .innerJoin(manufacturers, eq(manufacturers.id, purchases.manufacturerId))
    .leftJoin(schema.users, eq(schema.users.id, purchases.actorId))
    .where(eq(purchases.id, id));
  if (!purchase) return null;
  const items = await db
    .select()
    .from(purchaseItems)
    .where(eq(purchaseItems.purchaseId, id))
    .orderBy(asc(purchaseItems.productName), asc(purchaseItems.colorName));
  items.sort((a, b) => a.productName.localeCompare(b.productName, "tr") || a.colorName.localeCompare(b.colorName, "tr") || compareSizes(a.size, b.size));
  return { ...purchase, items };
}

export type PurchaseCatalogVariant = { id: string; size: string; productionBarcode: string; stock: number };
export type PurchaseCatalogProduct = {
  id: string;
  name: string;
  purchasePrice: number | null;
  colors: { id: string; name: string; variants: PurchaseCatalogVariant[] }[];
};

/** Fiş formu için: üreticinin ürünleri, renkleri ve numaraları (barkod okutma bu listeden eşleşir). */
export async function purchaseCatalog(manufacturerId: string): Promise<PurchaseCatalogProduct[]> {
  const id = parseManufacturerId(manufacturerId);
  const rows = await db
    .select({
      productId: products.id,
      productName: products.name,
      purchasePrice: productSupply.purchasePrice,
      colorId: productColors.id,
      colorName: productColors.name,
      colorPosition: productColors.position,
      variantId: variants.id,
      size: variants.size,
      productionBarcode: variants.productionBarcode,
      stock: variants.stock,
    })
    .from(productSupply)
    .innerJoin(products, eq(products.id, productSupply.productId))
    .innerJoin(productColors, eq(productColors.productId, products.id))
    .innerJoin(variants, eq(variants.colorId, productColors.id))
    .where(eq(productSupply.manufacturerId, id))
    .orderBy(asc(products.name), asc(productColors.position), asc(productColors.id));
  const out = new Map<string, PurchaseCatalogProduct>();
  for (const r of rows) {
    let p = out.get(r.productId);
    if (!p) out.set(r.productId, (p = { id: r.productId, name: r.productName, purchasePrice: r.purchasePrice, colors: [] }));
    let c = p.colors.find((x) => x.id === r.colorId);
    if (!c) p.colors.push((c = { id: r.colorId, name: r.colorName, variants: [] }));
    c.variants.push({ id: r.variantId, size: r.size, productionBarcode: r.productionBarcode, stock: r.stock });
  }
  for (const p of out.values()) for (const c of p.colors) c.variants.sort((a, b) => compareSizes(a.size, b.size));
  return [...out.values()];
}
