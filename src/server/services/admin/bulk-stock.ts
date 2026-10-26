import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { audit } from "../audit";
import { setPhysicalCount, setStock } from "../stock";
import { barcodeSchema, MAX_STOCK, noteSchema, skuSchema } from "./catalog";
import { AdminError, assertAdmin, isUniqueViolation, type AdminContext } from "./context";

const { variants, productColors, products } = schema;

/**
 * Toplu barkod ve stok: her satır "SKU; barkod; stok" (sekme, noktalı virgül ya da virgülle ayrılmış).
 * Barkod ya da stok boş bırakılırsa o alan değişmez. Önce önizlenir; uygulama ya hep ya hiç yapılır.
 */

export const MAX_BULK_LINES = 3000;

export type BulkMode = "available" | "physical";

export type BulkLine = { line: number; sku: string; barcode?: string; stock?: number };

export type BulkChange = {
  line: number;
  sku: string;
  label: string;
  barcodeFrom: string | null;
  barcodeTo: string | null;
  stockFrom: number;
  /** Girilen değer (depo sayımında sayım adedi) */
  stockValue?: number;
};

export type BulkResult = {
  errors: string[];
  changes: BulkChange[];
  barcodeChanges: number;
  stockChanges: number;
  applied: boolean;
};

export const bulkInputSchema = z.object({
  text: z.string().max(200_000, "En fazla 200.000 karakter yapıştırabilirsiniz; listeyi bölün."),
  mode: z.enum(["available", "physical"]),
  note: z.string().default(""),
  apply: z.boolean(),
});

/** Yapıştırılan metni satırlara ayırır; biçim hatalarını satır numarasıyla döner. */
export function parseBulkText(text: string): { lines: BulkLine[]; errors: string[] } {
  const lines: BulkLine[] = [];
  const errors: string[] = [];
  const raw = text.split(/\r?\n/);
  let first = true;
  for (const [i, original] of raw.entries()) {
    const n = i + 1;
    const row = original.trim();
    if (!row || row.startsWith("#")) continue;
    const sep = row.includes("\t") ? "\t" : row.includes(";") ? ";" : ",";
    const cells = row.split(sep).map((c) => c.trim());
    // İlk satır başlıksa ("SKU; Barkod; Stok") atlanır
    if (first && /^sku$/i.test(cells[0] ?? "")) {
      first = false;
      continue;
    }
    first = false;
    if (cells.length > 3) {
      errors.push(`${n}. satır: en fazla üç sütun olmalı (SKU; barkod; stok).`);
      continue;
    }
    const sku = skuSchema.safeParse(cells[0] ?? "");
    if (!sku.success) {
      errors.push(`${n}. satır: ${sku.error.issues[0]?.message ?? "SKU geçersiz."}`);
      continue;
    }
    const item: BulkLine = { line: n, sku: sku.data };
    const barcode = cells[1] ?? "";
    if (barcode) {
      const parsed = barcodeSchema.safeParse(barcode);
      if (!parsed.success || parsed.data.length < 4) {
        errors.push(`${n}. satır: barkod 4–32 karakter olmalı ve yalnızca harf, rakam ve tire içermeli.`);
        continue;
      }
      item.barcode = parsed.data;
    }
    const stock = cells[2] ?? "";
    if (stock) {
      if (!/^\d{1,6}$/.test(stock) || Number(stock) > MAX_STOCK) {
        errors.push(`${n}. satır: stok 0 ile 100.000 arasında bir tam sayı olmalı.`);
        continue;
      }
      item.stock = Number(stock);
    }
    if (item.barcode === undefined && item.stock === undefined) {
      errors.push(`${n}. satır: barkod ya da stok yazın.`);
      continue;
    }
    lines.push(item);
  }
  if (lines.length + errors.length > MAX_BULK_LINES) {
    return { lines: [], errors: [`En fazla ${MAX_BULK_LINES} satır işlenebilir; listeyi bölün.`] };
  }
  if (lines.length === 0 && errors.length === 0) errors.push("İşlenecek satır yok. Her satıra SKU; barkod; stok yazın.");
  return { lines, errors };
}

export async function bulkUpdateVariants(input: z.input<typeof bulkInputSchema>, ctx: AdminContext): Promise<BulkResult> {
  await assertAdmin(ctx);
  const parsedInput = bulkInputSchema.safeParse(input);
  if (!parsedInput.success) throw new AdminError(parsedInput.error.issues[0]?.message ?? "Girdi geçersiz.");
  const { text, mode, apply } = parsedInput.data;
  const { lines, errors } = parseBulkText(text);
  const empty: BulkResult = { errors, changes: [], barcodeChanges: 0, stockChanges: 0, applied: false };
  if (lines.length === 0) return empty;

  // Aynı SKU ya da barkod iki satırda olamaz
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  for (const l of lines) {
    const prev = seenSku.get(l.sku);
    if (prev) errors.push(`${l.line}. satır: ${l.sku} SKU'su ${prev}. satırda da var.`);
    else seenSku.set(l.sku, l.line);
    if (l.barcode) {
      const prevB = seenBarcode.get(l.barcode);
      if (prevB) errors.push(`${l.line}. satır: ${l.barcode} barkodu ${prevB}. satırda da var.`);
      else seenBarcode.set(l.barcode, l.line);
    }
  }

  const current = await db
    .select({
      id: variants.id,
      sku: variants.sku,
      barcode: variants.barcode,
      stock: variants.stock,
      size: variants.size,
      colorName: productColors.name,
      productName: products.name,
    })
    .from(variants)
    .innerJoin(productColors, eq(productColors.id, variants.colorId))
    .innerJoin(products, eq(products.id, productColors.productId))
    .where(inArray(variants.sku, [...seenSku.keys()]));
  const bySku = new Map(current.map((v) => [v.sku, v]));

  const changes: BulkChange[] = [];
  for (const l of lines) {
    const v = bySku.get(l.sku);
    if (!v) {
      errors.push(`${l.line}. satır: ${l.sku} SKU'su bulunamadı.`);
      continue;
    }
    const barcodeTo = l.barcode ?? v.barcode;
    const stockChanged = l.stock !== undefined && (mode === "physical" || l.stock !== v.stock);
    if (barcodeTo === v.barcode && !stockChanged) continue;
    changes.push({
      line: l.line,
      sku: v.sku,
      label: `${v.productName} · ${v.colorName} · ${v.size}`,
      barcodeFrom: v.barcode,
      barcodeTo,
      stockFrom: v.stock,
      stockValue: stockChanged ? l.stock : undefined,
    });
  }

  // Barkod başka bir numarada kullanılıyorsa (o numara bu listede başka barkoda geçmiyorsa) hata
  const newBarcodes = changes.filter((c) => c.barcodeTo !== c.barcodeFrom).map((c) => c.barcodeTo!);
  if (newBarcodes.length) {
    const owners = await db
      .select({ sku: variants.sku, barcode: variants.barcode })
      .from(variants)
      .where(inArray(variants.barcode, newBarcodes));
    const leaving = new Set(changes.filter((c) => c.barcodeTo !== c.barcodeFrom).map((c) => c.sku));
    for (const o of owners) {
      if (leaving.has(o.sku)) continue;
      const c = changes.find((x) => x.barcodeTo === o.barcode)!;
      if (c.sku !== o.sku) errors.push(`${c.line}. satır: ${o.barcode} barkodu ${o.sku} numarasında kullanılıyor.`);
    }
  }

  const stockChanges = changes.filter((c) => c.stockValue !== undefined).length;
  let note = "";
  if (stockChanges > 0) {
    const n = noteSchema.safeParse(parsedInput.data.note);
    if (!n.success) errors.push(n.error.issues[0]?.message ?? "Sebep yazın.");
    else note = n.data;
  }

  const result: BulkResult = {
    errors,
    changes,
    barcodeChanges: changes.filter((c) => c.barcodeTo !== c.barcodeFrom).length,
    stockChanges,
    applied: false,
  };
  if (!apply || errors.length > 0 || changes.length === 0) return result;

  try {
    await db.transaction(async (tx) => {
      const ids = changes.map((c) => bySku.get(c.sku)!.id);
      // Kimlik sırasıyla kilit (ödeme akışıyla aynı sıra)
      await tx.select({ id: variants.id }).from(variants).where(inArray(variants.id, ids)).orderBy(asc(variants.id)).for("update");
      const barcodeMoves = changes.filter((c) => c.barcodeTo !== c.barcodeFrom);
      // Önce eski barkodlar boşaltılır: liste içinde barkod takası benzersizlik kuralına takılmaz
      for (const c of barcodeMoves) await tx.update(variants).set({ barcode: null }).where(eq(variants.sku, c.sku));
      for (const c of barcodeMoves) await tx.update(variants).set({ barcode: c.barcodeTo }).where(eq(variants.sku, c.sku));
      const meta = { reason: "manual" as const, note, actorId: ctx.actorId };
      for (const c of changes) {
        if (c.stockValue === undefined) continue;
        const id = bySku.get(c.sku)!.id;
        if (mode === "physical") await setPhysicalCount(tx, id, c.stockValue, meta);
        else await setStock(tx, id, c.stockValue, meta);
      }
      await audit(
        {
          action: "variant.bulk_update",
          actorId: ctx.actorId,
          target: "toplu",
          data: {
            mode,
            note,
            barcodeChanges: result.barcodeChanges,
            stockChanges,
            changes: changes.slice(0, 500).map((c) => ({ sku: c.sku, barcode: c.barcodeTo, from: c.barcodeFrom, stock: c.stockValue })),
          },
          ip: ctx.ip,
        },
        tx,
      );
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AdminError("Bir barkod bu arada başka bir numaraya yazılmış. Önizlemeyi yenileyip yeniden deneyin.");
    throw e;
  }
  return { ...result, applied: true };
}
