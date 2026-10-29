"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parsePriceToKurus } from "@/lib/money";
import type { FormState } from "@/lib/form";
import { createManufacturer, deleteManufacturer, updateManufacturer } from "@/server/services/admin/manufacturers";
import { adminContext, errorState, parseForm } from "../../_lib/action";

const uuid = z.uuid("Üretici bulunamadı. Sayfayı yenileyin.");

/** "-1.250,00" gibi işaretli tutar; boşsa 0. */
const signedTl = z
  .string()
  .trim()
  .default("")
  .transform((s, ctx) => {
    if (!s) return 0;
    const negative = s.startsWith("-");
    const k = parsePriceToKurus(negative ? s.slice(1) : s);
    if (Number.isNaN(k)) {
      ctx.addIssue({ code: "custom", message: "Devir bakiyesini 12.500,00 biçiminde yazın (alacaklıysanız başına - koyun)." });
      return z.NEVER;
    }
    return negative ? -k : k;
  });

const manufacturerForm = z.object({
  name: z.string().max(300).default(""),
  contactName: z.string().max(300).default(""),
  phone: z.string().max(100).default(""),
  email: z.string().max(300).default(""),
  taxOffice: z.string().max(200).default(""),
  taxNumber: z.string().max(50).default(""),
  address: z.string().max(1000).default(""),
  iban: z.string().max(60).default(""),
  note: z.string().max(2000).default(""),
  openingBalance: signedTl,
  active: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

function refresh() {
  revalidatePath("/yonetim", "layout");
}

export async function createManufacturerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(manufacturerForm, form);
  if (!parsed.ok) return parsed.state;
  let id: string;
  try {
    ({ id } = await createManufacturer({ ...parsed.data, active: true }, ctx));
  } catch (e) {
    return errorState(e, parsed.values, "uretici-ekle");
  }
  refresh();
  redirect(`/yonetim/ureticiler/${id}`);
}

export async function updateManufacturerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const id = uuid.safeParse(form.get("manufacturerId"));
  if (!id.success) return { error: "Üretici bulunamadı. Sayfayı yenileyin." };
  const parsed = parseForm(manufacturerForm, form);
  if (!parsed.ok) return parsed.state;
  try {
    await updateManufacturer(id.data, parsed.data, ctx);
  } catch (e) {
    return errorState(e, parsed.values, "uretici-guncelle");
  }
  refresh();
  return { ok: true, message: "Üretici bilgileri kaydedildi." };
}

export async function deleteManufacturerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ manufacturerId: uuid }), form);
  if (!parsed.ok) return { error: "Geçersiz istek. Sayfayı yenileyin." };
  try {
    await deleteManufacturer(parsed.data.manufacturerId, ctx);
  } catch (e) {
    return errorState(e, undefined, "uretici-sil");
  }
  refresh();
  redirect("/yonetim/ureticiler");
}
