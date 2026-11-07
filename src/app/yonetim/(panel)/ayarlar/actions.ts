"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parsePriceToKurus } from "@/lib/money";
import type { FormState } from "@/lib/form";
import { saveSettings } from "@/server/services/admin/settings";
import { adminContext, errorState, parseForm } from "../../_lib/action";

const tl = (message: string) =>
  z
    .string()
    .trim()
    .transform((s, ctx) => {
      const k = s === "" ? 0 : parsePriceToKurus(s);
      if (Number.isNaN(k)) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return k;
    });

const text = (max: number) => z.string().max(max * 2).default("");

const intIn = (min: number, max: number, message: string) =>
  z.coerce.number({ message }).int(message).min(min, message).max(max, message);

const settingsForm = z.object({
  shippingFee: tl("Kargo ücretini 99,90 biçiminde yazın (ücretsizse 0)."),
  freeShippingThreshold: tl("Ücretsiz kargo eşiğini 1.500,00 biçiminde yazın (her siparişte ücretli kargo için 0)."),
  companyName: text(200),
  companyAddress: text(500),
  taxOffice: text(100),
  taxNumber: text(20),
  mersisNumber: text(30),
  email: text(200),
  phone: text(30),
  kepAddress: text(200),
  instagramUrl: text(300),
  trendyolUrl: text(300),
  announcement: text(200),
  stockAlertThreshold: z.coerce
    .number({ message: "Stok uyarı eşiğini 0 ile 100 arasında bir tam sayı olarak yazın." })
    .int("Stok uyarı eşiğini 0 ile 100 arasında bir tam sayı olarak yazın.")
    .min(0, "Stok uyarı eşiğini 0 ile 100 arasında bir tam sayı olarak yazın.")
    .max(100, "Stok uyarı eşiğini 0 ile 100 arasında bir tam sayı olarak yazın."),
  n11PricePercent: intIn(0, 200, "N11 fiyat oranını 0 ile 200 arasında bir tam sayı olarak yazın (ör. 33)."),
  n11PreparingDay: intIn(1, 30, "Hazırlama süresini 1 ile 30 gün arasında yazın."),
  n11VatRate: z.coerce
    .number()
    .refine((n): n is 0 | 1 | 10 | 20 => [0, 1, 10, 20].includes(n), "KDV oranını 0, 1, 10 ya da 20 seçin.")
    .transform((n) => n as 0 | 1 | 10 | 20),
  n11ShipmentTemplate: text(100),
  n11Brand: text(60),
});

export async function saveSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(settingsForm, form);
  if (!parsed.ok) return parsed.state;
  try {
    await saveSettings(parsed.data, ctx);
  } catch (e) {
    return errorState(e, parsed.values, "ayarlar");
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Ayarlar kaydedildi; vitrinde hemen geçerli." };
}
