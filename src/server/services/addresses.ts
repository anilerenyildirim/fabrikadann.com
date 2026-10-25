import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import type { AddressSnapshot } from "@/server/db/schema";
import { CITIES } from "@/data/iller";

const { addresses } = schema;

export const MAX_ADDRESSES = 10;

/** Türkiye cep/sabit hat: boşluk, tire, parantez atılır; 0 ile başlayan 11 hane ya da +90 ile 12 hane. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, "");
  const m = /^(?:\+?90|0)?([2-5]\d{9})$/.exec(digits);
  return m ? `0${m[1]}` : null;
}

export const addressSchema = z.object({
  fullName: z.string().trim().min(3, "Ad soyad girin.").max(80),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const p = normalizePhone(v);
      if (!p) ctx.addIssue({ code: "custom", message: "Geçerli bir telefon numarası girin (05xx xxx xx xx)." });
      return p ?? "";
    }),
  city: z.string().refine((c) => (CITIES as readonly string[]).includes(c), "İl seçin."),
  district: z.string().trim().min(2, "İlçe girin.").max(60),
  line: z.string().trim().min(10, "Mahalle, sokak, bina ve daire bilgisini girin.").max(300),
});

export const savedAddressSchema = addressSchema.extend({
  title: z.string().trim().min(1, "Adrese bir ad verin (ör. Ev).").max(40),
});

export type AddressInput = z.infer<typeof savedAddressSchema>;

export async function listAddresses(userId: string) {
  return db.select().from(addresses).where(eq(addresses.userId, userId)).orderBy(asc(addresses.createdAt));
}

/** Adres yalnızca sahibine döner. */
export async function getAddress(userId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await db
    .select()
    .from(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function createAddress(userId: string, input: AddressInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(addresses)
    .where(eq(addresses.userId, userId));
  if ((count?.n ?? 0) >= MAX_ADDRESSES) return { ok: false, error: `En fazla ${MAX_ADDRESSES} adres kaydedebilirsiniz.` };
  const [row] = await db
    .insert(addresses)
    .values({ userId, ...input })
    .returning({ id: addresses.id });
  return { ok: true, id: row!.id };
}

export async function updateAddress(userId: string, id: string, input: AddressInput): Promise<boolean> {
  if (!z.string().uuid().safeParse(id).success) return false;
  const updated = await db
    .update(addresses)
    .set(input)
    .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
    .returning({ id: addresses.id });
  return updated.length === 1;
}

export async function deleteAddress(userId: string, id: string): Promise<boolean> {
  if (!z.string().uuid().safeParse(id).success) return false;
  const deleted = await db
    .delete(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
    .returning({ id: addresses.id });
  return deleted.length === 1;
}

export function toSnapshot(a: Pick<AddressSnapshot, keyof AddressSnapshot>): AddressSnapshot {
  return { fullName: a.fullName, phone: a.phone, city: a.city, district: a.district, line: a.line };
}
