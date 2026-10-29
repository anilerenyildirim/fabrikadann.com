import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { audit } from "../audit";
import { AdminError, assertAdmin, type AdminContext } from "./context";
import { assertManufacturer, MAX_AMOUNT_KURUS } from "./manufacturers";
import { businessDateSchema } from "./purchases";

const { ledgerEntries, manufacturers } = schema;

export type LedgerKind = (typeof schema.ledgerKind.enumValues)[number];

export const INCOME_CATEGORIES = {
  trendyol: "Trendyol hakedişi",
  other_sales: "Diğer satış",
  manufacturer_refund: "Üreticiden tahsilat",
  other_income: "Diğer gelir",
} as const;

export const EXPENSE_CATEGORIES = {
  manufacturer_payment: "Üretici ödemesi",
  shipping: "Kargo",
  packaging: "Ambalaj",
  advertising: "Reklam",
  commission: "Ödeme ve pazaryeri komisyonu",
  rent: "Kira",
  salary: "Personel",
  utilities: "Elektrik, su, internet",
  tax: "Vergi ve harç",
  other_expense: "Diğer gider",
} as const;

export const CATEGORY_LABELS: Record<string, string> = { ...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES };

/** Üreticiyle ilişkili kategoriler: cari bakiyeyi değiştirir, kâr-zarara girmez. */
export const MANUFACTURER_CATEGORIES = ["manufacturer_payment", "manufacturer_refund"] as const;

export const PAYMENT_METHODS = {
  bank: "Banka / EFT",
  cash: "Nakit",
  card: "Kredi kartı",
  other: "Diğer",
} as const;

const categoryKeys = [...Object.keys(INCOME_CATEGORIES), ...Object.keys(EXPENSE_CATEGORIES)] as [string, ...string[]];

export const ledgerInputSchema = z
  .object({
    kind: z.enum(["income", "expense"], { error: "Gelir mi gider mi, seçin." }),
    category: z.enum(categoryKeys, { error: "Kategori seçin." }),
    date: businessDateSchema,
    amount: z
      .number({ error: "Tutarı 1.250,00 biçiminde yazın." })
      .int("Tutarı 1.250,00 biçiminde yazın.")
      .min(1, "Tutar 0'dan büyük olmalı.")
      .max(MAX_AMOUNT_KURUS, "Tutar çok büyük."),
    method: z.enum(Object.keys(PAYMENT_METHODS) as [string, ...string[]], { error: "Ödeme şeklini seçin." }),
    description: z.string().trim().max(300, "Açıklama en fazla 300 karakter olabilir.").default(""),
    manufacturerId: z.uuid("Üretici seçin.").nullable().default(null),
  })
  .superRefine((v, c) => {
    const inKind = v.kind === "income" ? v.category in INCOME_CATEGORIES : v.category in EXPENSE_CATEGORIES;
    if (!inKind) c.addIssue({ code: "custom", path: ["category"], message: "Kategori bu kayıt türüne uymuyor; yeniden seçin." });
    const needsManufacturer = (MANUFACTURER_CATEGORIES as readonly string[]).includes(v.category);
    if (needsManufacturer && !v.manufacturerId) {
      c.addIssue({ code: "custom", path: ["manufacturerId"], message: "Hangi üreticiye ait olduğunu seçin." });
    }
    if (!needsManufacturer && v.manufacturerId) {
      c.addIssue({
        code: "custom",
        path: ["manufacturerId"],
        message: "Üretici yalnızca üretici ödemesi ya da üreticiden tahsilatta seçilir.",
      });
    }
  });

export type LedgerInput = z.input<typeof ledgerInputSchema>;

export async function createLedgerEntry(raw: LedgerInput, ctx: AdminContext): Promise<{ id: string }> {
  await assertAdmin(ctx);
  const r = ledgerInputSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new AdminError(issue?.message ?? "Geçersiz değer.", issue?.path.join(".") || undefined);
  }
  const input = r.data;
  return db.transaction(async (tx) => {
    if (input.manufacturerId) await assertManufacturer(input.manufacturerId, tx);
    const [row] = await tx
      .insert(ledgerEntries)
      .values({ ...input, actorId: ctx.actorId })
      .returning({ id: ledgerEntries.id });
    await audit(
      {
        action: "ledger.create",
        actorId: ctx.actorId,
        target: row!.id,
        data: { kind: input.kind, category: input.category, date: input.date, amount: input.amount, manufacturerId: input.manufacturerId },
        ip: ctx.ip,
      },
      tx,
    );
    return row!;
  });
}

/** Yanlış girilen kaydı siler; silinen kaydın tamamı işlem günlüğünde kalır. */
export async function deleteLedgerEntry(id: string, ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  if (!z.uuid().safeParse(id).success) throw new AdminError("Kayıt bulunamadı. Sayfayı yenileyin.");
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(ledgerEntries).where(eq(ledgerEntries.id, id)).returning();
    if (!row) throw new AdminError("Kayıt bulunamadı; zaten silinmiş olabilir.");
    await audit({ action: "ledger.delete", actorId: ctx.actorId, target: id, data: { ...row, createdAt: undefined }, ip: ctx.ip }, tx);
  });
}

const PAGE_SIZE = 100;

export async function listLedgerEntries(
  input: { from?: string; to?: string; kind?: LedgerKind; manufacturerId?: string; page?: number } = {},
) {
  const where: SQL[] = [];
  if (input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from)) where.push(gte(ledgerEntries.date, input.from));
  if (input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to)) where.push(lte(ledgerEntries.date, input.to));
  if (input.kind === "income" || input.kind === "expense") where.push(eq(ledgerEntries.kind, input.kind));
  if (input.manufacturerId && z.uuid().safeParse(input.manufacturerId).success) {
    where.push(eq(ledgerEntries.manufacturerId, input.manufacturerId));
  }
  const filter = where.length ? and(...where) : undefined;
  const page = Math.max(1, input.page ?? 1);
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: ledgerEntries.id,
        kind: ledgerEntries.kind,
        category: ledgerEntries.category,
        date: ledgerEntries.date,
        amount: ledgerEntries.amount,
        method: ledgerEntries.method,
        description: ledgerEntries.description,
        manufacturerId: ledgerEntries.manufacturerId,
        manufacturerName: manufacturers.name,
      })
      .from(ledgerEntries)
      .leftJoin(manufacturers, eq(manufacturers.id, ledgerEntries.manufacturerId))
      .where(filter)
      .orderBy(desc(ledgerEntries.date), desc(ledgerEntries.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(ledgerEntries).where(filter),
  ]);
  return { rows, total: total?.n ?? 0, page, pageCount: Math.max(1, Math.ceil((total?.n ?? 0) / PAGE_SIZE)) };
}
