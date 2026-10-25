import { z } from "zod";
import { audit } from "../audit";
import { getSettings, settingsSchema, updateSettings, type Settings } from "../settings";
import { AdminError, assertAdmin, type AdminContext } from "./context";

const MAX_FEE = 10_000_000; // 100.000 TL
const MAX_PRICE = 100_000_000; // 1.000.000 TL

/** Yalnızca https:// ile başlayan, kimlik bilgisi içermeyen adres ya da boş. */
const httpsUrlOrEmpty = (what: string) =>
  z
    .string()
    .trim()
    .max(300, `${what} adresi en fazla 300 karakter olabilir.`)
    .refine((v) => {
      if (v === "") return true;
      try {
        const u = new URL(v);
        return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
      } catch {
        return false;
      }
    }, `${what} adresi https:// ile başlamalı (ör. https://instagram.com/fabrikadann).`);

/** Panel formundan gelen ayarlar: depolama şemasından daha sıkı. */
export const adminSettingsSchema = settingsSchema.extend({
  shippingFee: z
    .number({ error: "Kargo ücretini 99,90 biçiminde yazın." })
    .int()
    .min(0, "Kargo ücreti 0'dan küçük olamaz.")
    .max(MAX_FEE, "Kargo ücreti çok yüksek."),
  freeShippingThreshold: z
    .number({ error: "Ücretsiz kargo eşiğini 1.500,00 biçiminde yazın." })
    .int()
    .min(0, "Eşik 0'dan küçük olamaz.")
    .max(MAX_PRICE, "Eşik çok yüksek."),
  companyName: z.string().trim().max(200, "Unvan en fazla 200 karakter olabilir."),
  companyAddress: z.string().trim().max(500, "Adres en fazla 500 karakter olabilir."),
  taxOffice: z.string().trim().max(100, "Vergi dairesi en fazla 100 karakter olabilir."),
  taxNumber: z
    .string()
    .trim()
    .regex(/^(\d{10,11})?$/, "Vergi numarası 10, TC kimlik numarası 11 haneli olmalı; boş da bırakabilirsiniz."),
  mersisNumber: z
    .string()
    .trim()
    .regex(/^(\d{16})?$/, "MERSİS numarası 16 haneli olmalı; boş da bırakabilirsiniz."),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Geçerli bir e-posta adresi yazın."),
  phone: z
    .string()
    .trim()
    .max(30, "Telefon en fazla 30 karakter olabilir.")
    .regex(/^[0-9 +()-]*$/, "Telefonu yalnızca rakam, boşluk ve + ( ) - ile yazın."),
  kepAddress: z.string().trim().max(200, "KEP adresi en fazla 200 karakter olabilir."),
  instagramUrl: httpsUrlOrEmpty("Instagram"),
  trendyolUrl: httpsUrlOrEmpty("Trendyol"),
  announcement: z.string().trim().max(200, "Duyuru en fazla 200 karakter olabilir.").refine((v) => !/[\r\n]/.test(v), "Duyuru tek satır olmalı."),
});


export type AdminSettingsInput = z.input<typeof adminSettingsSchema>;

export async function saveSettings(raw: AdminSettingsInput, ctx: AdminContext): Promise<Settings> {
  await assertAdmin(ctx);
  const parsed = adminSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AdminError(issue?.message ?? "Geçersiz ayar.", issue?.path.join(".") || undefined);
  }
  const before = await getSettings();
  const next = await updateSettings(parsed.data);
  const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => next[k] !== before[k]);
  if (changed.length > 0) {
    await audit({
      action: "settings.update",
      actorId: ctx.actorId,
      target: "store",
      data: {
        changed,
        ...(changed.includes("shippingFee") ? { shippingFee: { from: before.shippingFee, to: next.shippingFee } } : {}),
        ...(changed.includes("freeShippingThreshold")
          ? { freeShippingThreshold: { from: before.freeShippingThreshold, to: next.freeShippingThreshold } }
          : {}),
      },
      ip: ctx.ip,
    });
  }
  return next;
}
