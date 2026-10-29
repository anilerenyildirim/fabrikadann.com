import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type DbOrTx } from "@/server/db";
import { audit } from "../audit";
import { AdminError, assertAdmin, isUniqueViolation, type AdminContext } from "./context";

const { manufacturers, productSupply } = schema;

export const MAX_AMOUNT_KURUS = 1_000_000_000; // 10.000.000 TL

const text = (max: number, what: string) =>
  z.string().trim().max(max, `${what} en fazla ${max} karakter olabilir.`).default("");

export const manufacturerInputSchema = z.object({
  name: z.string().trim().min(1, "Üretici adını yazın.").max(120, "Üretici adı en fazla 120 karakter olabilir."),
  contactName: text(120, "Yetkili adı"),
  phone: text(40, "Telefon"),
  email: z
    .string()
    .trim()
    .max(200, "E-posta en fazla 200 karakter olabilir.")
    .refine((v) => v === "" || z.email().safeParse(v).success, "E-postayı ad@ornek.com biçiminde yazın ya da boş bırakın.")
    .default(""),
  taxOffice: text(80, "Vergi dairesi"),
  taxNumber: z
    .string()
    .trim()
    .regex(/^(\d{10,11})?$/, "Vergi numarası 10, TC kimlik numarası 11 haneli olmalı; bilmiyorsanız boş bırakın.")
    .default(""),
  address: text(500, "Adres"),
  iban: z
    .string()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().regex(/^(TR\d{24})?$/, "IBAN'ı TR ile başlayan 26 karakter olarak yazın ya da boş bırakın."))
    .default(""),
  note: text(1000, "Not"),
  openingBalance: z
    .number({ error: "Devir bakiyesini 12.500,00 biçiminde yazın." })
    .int("Devir bakiyesini 12.500,00 biçiminde yazın.")
    .min(-MAX_AMOUNT_KURUS, "Devir bakiyesi çok büyük.")
    .max(MAX_AMOUNT_KURUS, "Devir bakiyesi çok büyük.")
    .default(0),
  active: z.boolean().default(true),
});

export type ManufacturerInput = z.input<typeof manufacturerInputSchema>;
export type Manufacturer = typeof manufacturers.$inferSelect;

function parse<T>(s: z.ZodType<T>, value: unknown): T {
  const r = s.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new AdminError(issue?.message ?? "Geçersiz değer.", issue?.path.join(".") || undefined);
  }
  return r.data;
}

export function parseManufacturerId(value: unknown): string {
  const r = z.uuid().safeParse(value);
  if (!r.success) throw new AdminError("Üretici bulunamadı. Sayfayı yenileyin.");
  return r.data;
}

const nameTaken = () => new AdminError("Bu adla bir üretici zaten var. Farklı bir ad yazın.", "name");

export async function createManufacturer(raw: ManufacturerInput, ctx: AdminContext): Promise<{ id: string }> {
  await assertAdmin(ctx);
  const input = parse(manufacturerInputSchema, raw);
  try {
    const [row] = await db.insert(manufacturers).values(input).returning({ id: manufacturers.id });
    await audit({ action: "manufacturer.create", actorId: ctx.actorId, target: row!.id, data: { name: input.name }, ip: ctx.ip });
    return row!;
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
}

export async function updateManufacturer(id: string, raw: ManufacturerInput, ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const manufacturerId = parseManufacturerId(id);
  const input = parse(manufacturerInputSchema, raw);
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(manufacturers).where(eq(manufacturers.id, manufacturerId)).for("update");
      if (!current) throw new AdminError("Üretici bulunamadı.");
      await tx.update(manufacturers).set(input).where(eq(manufacturers.id, manufacturerId));
      const changed = (Object.keys(input) as (keyof typeof input)[]).filter((k) => input[k] !== current[k]);
      await audit(
        {
          action: "manufacturer.update",
          actorId: ctx.actorId,
          target: manufacturerId,
          data: {
            changed,
            ...(changed.includes("openingBalance")
              ? { openingBalance: { from: current.openingBalance, to: input.openingBalance } }
              : {}),
          },
          ip: ctx.ip,
        },
        tx,
      );
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
}

/** Yalnızca hiç kaydı olmayan üretici silinir; geçmişi olan pasife alınır (cari geçmişi kaybolmasın). */
export async function deleteManufacturer(id: string, ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const manufacturerId = parseManufacturerId(id);
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(manufacturers).where(eq(manufacturers.id, manufacturerId)).for("update");
    if (!current) throw new AdminError("Üretici bulunamadı.");
    const result = await tx.execute<{ n: number }>(sql`
      select (
        (select count(*) from product_supply where manufacturer_id = ${manufacturerId}) +
        (select count(*) from purchases where manufacturer_id = ${manufacturerId}) +
        (select count(*) from ledger_entries where manufacturer_id = ${manufacturerId}) +
        (select count(*) from order_item_costs where manufacturer_id = ${manufacturerId}) +
        (select count(*) from trendyol_order_stock where manufacturer_id = ${manufacturerId})
      )::int as n
    `);
    if (Number(result.rows[0]?.n ?? 0) > 0 || current.openingBalance !== 0) {
      throw new AdminError("Bu üreticinin ürünleri ya da cari kayıtları var; silinemez. Pasife alabilirsiniz.");
    }
    await tx.delete(manufacturers).where(eq(manufacturers.id, manufacturerId));
    await audit({ action: "manufacturer.delete", actorId: ctx.actorId, target: manufacturerId, data: { name: current.name }, ip: ctx.ip }, tx);
  });
}

export async function getManufacturer(id: string): Promise<Manufacturer | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.select().from(manufacturers).where(eq(manufacturers.id, id));
  return row ?? null;
}

/** Seçim listeleri için: etkin üreticiler (ve verilmişse şu an seçili olan, pasif olsa da). */
export async function manufacturerOptions(includeId?: string | null): Promise<{ id: string; name: string; active: boolean }[]> {
  const rows = await db
    .select({ id: manufacturers.id, name: manufacturers.name, active: manufacturers.active })
    .from(manufacturers)
    .orderBy(asc(manufacturers.name));
  return rows.filter((r) => r.active || r.id === includeId);
}

export async function assertManufacturer(id: string, tx: DbOrTx, field = "manufacturerId") {
  const [row] = await tx.select({ active: manufacturers.active }).from(manufacturers).where(eq(manufacturers.id, id));
  if (!row) throw new AdminError("Seçilen üretici bulunamadı. Listeden yeniden seçin.", field);
  return row;
}

// ---------- Ürünün üreticisi ve alış fiyatı ----------

export type ProductSupply = { manufacturerId: string | null; purchasePrice: number | null };

export async function getProductSupply(productId: string, tx: DbOrTx = db): Promise<ProductSupply> {
  const [row] = await tx
    .select({ manufacturerId: productSupply.manufacturerId, purchasePrice: productSupply.purchasePrice })
    .from(productSupply)
    .where(eq(productSupply.productId, productId));
  return row ?? { manufacturerId: null, purchasePrice: null };
}

/** Ürün kaydıyla aynı işlemde çağrılır (yetki ve doğrulama çağıranda). */
export async function writeProductSupply(productId: string, supply: ProductSupply, tx: DbOrTx): Promise<void> {
  await tx
    .insert(productSupply)
    .values({ productId, ...supply })
    .onConflictDoUpdate({ target: productSupply.productId, set: { ...supply, updatedAt: new Date() } });
}

export async function productIdsOfManufacturer(manufacturerId: string): Promise<string[]> {
  const rows = await db
    .select({ id: productSupply.productId })
    .from(productSupply)
    .where(and(eq(productSupply.manufacturerId, manufacturerId)));
  return rows.map((r) => r.id);
}
