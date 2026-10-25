import { and, asc, desc, eq, gt, like, lte, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { compareSizes, foldForSearch } from "../catalog";
import { reservedByVariant } from "../stock";
import { LOW_STOCK } from "./dashboard";

const { variants, productColors, products, stockMovements, users } = schema;

export type StockFilter = "all" | "out" | "low";

export type StockRow = {
  variantId: string;
  productId: string;
  productName: string;
  productStatus: (typeof schema.productStatus.enumValues)[number];
  colorName: string;
  colorPosition: number;
  size: string;
  sku: string;
  barcode: string | null;
  stock: number;
  /** Kargolanmamış siparişlerde ayrılmış adet (stoktan zaten düşülmüş) */
  reserved: number;
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Stok sayfası: tüm varyantlar (ürün, renk, numara sırasıyla). Arşivdeki ürünler "hepsi"nde görünür. */
export async function listStockRows(input: { filter?: StockFilter; q?: string } = {}): Promise<StockRow[]> {
  const where: SQL[] = [];
  if (input.filter === "out") where.push(lte(variants.stock, 0));
  if (input.filter === "low") where.push(and(gt(variants.stock, 0), lte(variants.stock, LOW_STOCK))!);
  if (input.filter === "out" || input.filter === "low") where.push(sql`${products.status} <> 'archived'`);
  const q = input.q?.trim().slice(0, 80);
  if (q) {
    const folded = `%${escapeLike(foldForSearch(q))}%`;
    where.push(
      or(
        sql`lower(translate(${products.name}, 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc')) LIKE ${folded}`,
        like(variants.sku, `%${escapeLike(q.toUpperCase())}%`),
        like(variants.barcode, `%${escapeLike(q)}%`),
      )!,
    );
  }
  const rows = await db
    .select({
      variantId: variants.id,
      productId: products.id,
      productName: products.name,
      productStatus: products.status,
      colorName: productColors.name,
      colorPosition: productColors.position,
      size: variants.size,
      sku: variants.sku,
      barcode: variants.barcode,
      stock: variants.stock,
    })
    .from(variants)
    .innerJoin(productColors, eq(productColors.id, variants.colorId))
    .innerJoin(products, eq(products.id, productColors.productId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(products.name), asc(products.id), asc(productColors.position))
    .limit(2000);
  const reserved = await reservedByVariant(db);
  // Aynı ürün ve renk içinde numaraları sayısal sırala
  return rows.map((r) => ({ ...r, reserved: reserved.get(r.variantId) ?? 0 })).sort(
    (a, b) =>
      a.productName.localeCompare(b.productName, "tr") ||
      a.productId.localeCompare(b.productId) ||
      a.colorPosition - b.colorPosition ||
      compareSizes(a.size, b.size),
  );
}

export const STOCK_REASON_LABELS: Record<(typeof schema.stockReason.enumValues)[number], string> = {
  order: "Sipariş",
  cancel: "İptal / iade",
  manual: "Elle düzeltme",
  trendyol: "Trendyol",
  initial: "İlk stok",
};

export async function listStockMovements(limit = 50) {
  return db
    .select({
      id: stockMovements.id,
      delta: stockMovements.delta,
      reason: stockMovements.reason,
      reference: stockMovements.reference,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
      sku: variants.sku,
      size: variants.size,
      productName: products.name,
      productId: products.id,
      colorName: productColors.name,
      actorEmail: users.email,
    })
    .from(stockMovements)
    .innerJoin(variants, eq(variants.id, stockMovements.variantId))
    .innerJoin(productColors, eq(productColors.id, variants.colorId))
    .innerJoin(products, eq(products.id, productColors.productId))
    .leftJoin(users, eq(users.id, stockMovements.actorId))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(Math.min(Math.max(limit, 1), 500));
}
