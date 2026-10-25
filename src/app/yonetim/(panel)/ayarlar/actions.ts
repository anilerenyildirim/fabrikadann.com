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
