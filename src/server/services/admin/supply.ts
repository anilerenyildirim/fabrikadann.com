import { asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { audit } from "../audit";
import { AdminError, assertAdmin, type AdminContext } from "./context";

/*
  Toplu üretici ve alış fiyatı girişi (yalnızca yönetim). Trendyol'dan aktarılan ya da eskiden eklenen ürünlere
  muhasebe için gereken bilgiyi tek tabloda girmeye yarar. Kurallar ürün formuyla aynıdır:
  alış fişi olan ürünün üreticisi değişmez; yeni seçilen üretici etkin olmalıdır.
*/

const { products, productSupply, manufacturers, purchaseItems, categories } = schema;

const MAX_PRICE_KURUS = 100_000_000; // 1.000.000 TL (ürün formuyla aynı)
export const MAX_SUPPLY_ROWS = 500;

export type SupplyRow = {
  productId: string;
  name: string;
  status: "draft" | "active" | "archived";
  category: string | null;
  price: number;
  manufacturerId: string | null;
  purchasePrice: number | null;
  /** Alış fişi var: üretici değiştirilemez */
  locked: boolean;
};

/** Ürünler ve tedarik bilgileri; `missingOnly` ise üreticisi ya da alış fiyatı eksik olanlar. */
export async function listSupplyRows(opts: { missingOnly?: boolean } = {}): Promise<SupplyRow[]> {
  const rows = await db
    .select({
      productId: products.id,
      name: products.name,
      status: products.status,
      category: categories.name,
      price: products.price,
      manufacturerId: productSupply.manufacturerId,
      purchasePrice: productSupply.purchasePrice,
      locked: sql<boolean>`exists (select 1 from ${purchaseItems} pi where pi.product_id = ${products.id})`,
    })
    .from(products)
    .leftJoin(productSupply, eq(productSupply.productId, products.id))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(opts.missingOnly ? or(isNull(productSupply.manufacturerId), isNull(productSupply.purchasePrice)) : undefined)
    .orderBy(sql`case ${products.status} when 'active' then 0 when 'draft' then 1 else 2 end`, asc(products.name))
    .limit(MAX_SUPPLY_ROWS);
  return rows.map((r) => ({ ...r, locked: Boolean(r.locked) }));
}

export const supplyUpdateSchema = z
  .array(
    z.object({
      productId: z.uuid("Ürün bulunamadı. Sayfayı yenileyin."),
      manufacturerId: z.uuid("Üretici bulunamadı. Listeden yeniden seçin.").nullable(),
      purchasePrice: z
        .number()
        .int("Alış fiyatını 850,00 biçiminde yazın.")
        .min(0, "Alış fiyatı 0'dan küçük olamaz.")
        .max(MAX_PRICE_KURUS, "Alış fiyatı 1.000.000 TL'den küçük olmalı.")
        .nullable(),
    }),
  )
  .max(MAX_SUPPLY_ROWS, `Tek seferde en fazla ${MAX_SUPPLY_ROWS} ürün kaydedilebilir.`);

export type SupplyUpdate = z.input<typeof supplyUpdateSchema>[number];

/** Sorunlu satır: hangi ürün, ne yapılmalı. Hata varsa hiçbir satır kaydedilmez. */
export class SupplyError extends AdminError {
  constructor(
    message: string,
    readonly productId: string,
  ) {
    // Alan adı satırı gösterir: form hatayı ilgili ürünün yanında gösterir
    super(message, `satir-${productId}`);
  }
}

/** Değişen satırları tek işlemde yazar; her değişiklik işlem günlüğüne geçer. Dönen: değişen ürün sayısı. */
export async function bulkUpdateSupply(raw: SupplyUpdate[], ctx: AdminContext): Promise<{ changed: number }> {
  await assertAdmin(ctx);
  const parsed = supplyUpdateSchema.safeParse(raw);
  if (!parsed.success) throw new AdminError(parsed.error.issues[0]?.message ?? "Liste geçersiz. Sayfayı yenileyin.");
  const input = parsed.data;
  if (input.length === 0) return { changed: 0 };
  if (new Set(input.map((r) => r.productId)).size !== input.length) {
    throw new AdminError("Aynı ürün listede iki kez var. Sayfayı yenileyin.");
  }

  return db.transaction(async (tx) => {
    const ids = input.map((r) => r.productId);
    // Ürünler kilitlenir: aynı anda ürün formundan yapılan değişiklikle çakışmasın
    const existing = await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, ids))
      .for("update");
    const names = new Map(existing.map((p) => [p.id, p.name]));
    const current = new Map(
      (
        await tx
          .select({
            productId: productSupply.productId,
            manufacturerId: productSupply.manufacturerId,
            purchasePrice: productSupply.purchasePrice,
          })
          .from(productSupply)
          .where(inArray(productSupply.productId, ids))
      ).map((r) => [r.productId, r]),
    );
    const received = new Set(
      (
        await tx
          .selectDistinct({ productId: purchaseItems.productId })
          .from(purchaseItems)
          .where(inArray(purchaseItems.productId, ids))
      ).map((r) => r.productId),
    );
    const newManufacturerIds = [...new Set(input.map((r) => r.manufacturerId).filter((v): v is string => !!v))];
    const activeById = new Map(
      newManufacturerIds.length
        ? (
            await tx
              .select({ id: manufacturers.id, active: manufacturers.active })
              .from(manufacturers)
              .where(inArray(manufacturers.id, newManufacturerIds))
          ).map((m) => [m.id, m.active])
        : [],
    );

    let changed = 0;
    for (const row of input) {
      const name = names.get(row.productId);
      if (name === undefined) throw new SupplyError("Ürün bulunamadı (silinmiş olabilir). Sayfayı yenileyin.", row.productId);
      const before = current.get(row.productId) ?? { manufacturerId: null, purchasePrice: null };
      const manufacturerChanged = row.manufacturerId !== before.manufacturerId;
      const priceChanged = row.purchasePrice !== before.purchasePrice;
      if (!manufacturerChanged && !priceChanged) continue;

      if (manufacturerChanged) {
        if (before.manufacturerId && received.has(row.productId)) {
          throw new SupplyError(
            `"${name}" için alış fişi var; üreticisi değiştirilemez. Farklı üreticiden gelen ürünü ayrı ürün olarak ekleyin.`,
            row.productId,
          );
        }
        if (row.manufacturerId) {
          const active = activeById.get(row.manufacturerId);
          if (active === undefined) throw new SupplyError(`"${name}" için seçilen üretici bulunamadı. Listeden yeniden seçin.`, row.productId);
          if (!active) throw new SupplyError(`"${name}" için seçilen üretici pasif. Etkin bir üretici seçin.`, row.productId);
        }
      }

      await tx
        .insert(productSupply)
        .values({ productId: row.productId, manufacturerId: row.manufacturerId, purchasePrice: row.purchasePrice })
        .onConflictDoUpdate({
          target: productSupply.productId,
          set: { manufacturerId: row.manufacturerId, purchasePrice: row.purchasePrice, updatedAt: new Date() },
        });
      await audit(
        {
          action: "product.supply_bulk",
          actorId: ctx.actorId,
          target: row.productId,
          data: {
            ...(manufacturerChanged ? { manufacturerId: { from: before.manufacturerId, to: row.manufacturerId } } : {}),
            ...(priceChanged ? { purchasePrice: { from: before.purchasePrice, to: row.purchasePrice } } : {}),
          },
          ip: ctx.ip,
        },
        tx,
      );
      changed++;
    }
    return { changed };
  });
}

/** Kayıtlı ürün sayısı ve eksik bilgili olanlar (sayfa başlığı için). */
export async function supplyCounts(): Promise<{ total: number; missing: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      missing: sql<number>`count(*) filter (where ${productSupply.manufacturerId} is null or ${productSupply.purchasePrice} is null)::int`,
    })
    .from(products)
    .leftJoin(productSupply, eq(productSupply.productId, products.id));
  return { total: row?.total ?? 0, missing: row?.missing ?? 0 };
}
