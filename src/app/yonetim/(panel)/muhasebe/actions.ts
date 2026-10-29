"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parsePriceToKurus } from "@/lib/money";
import type { FormState } from "@/lib/form";
import { formatPrice } from "@/lib/money";
import { createLedgerEntry, deleteLedgerEntry } from "@/server/services/admin/ledger";
import { createPurchase } from "@/server/services/admin/purchases";
import { adminContext, errorState, parseForm } from "../../_lib/action";

function refresh() {
  revalidatePath("/yonetim", "layout");
}

const ledgerForm = z.object({
  kind: z.string().max(20).default(""),
  category: z.string().max(40).default(""),
  date: z.string().max(20).default(""),
  amount: z
    .string()
    .trim()
    .default("")
    .transform((s, ctx) => {
      const k = parsePriceToKurus(s);
      if (!s || Number.isNaN(k)) {
        ctx.addIssue({ code: "custom", message: "Tutarı 1.250,00 biçiminde yazın." });
        return z.NEVER;
      }
      return k;
    }),
  method: z.string().max(20).default(""),
  description: z.string().max(1000).default(""),
  manufacturerId: z
    .string()
    .default("")
    .transform((v) => v || null),
});

export async function createLedgerEntryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(ledgerForm, form);
  if (!parsed.ok) return parsed.state;
  try {
    await createLedgerEntry(parsed.data as Parameters<typeof createLedgerEntry>[0], ctx);
  } catch (e) {
    return errorState(e, parsed.values, "gelir-gider-ekle");
  }
  refresh();
  return { ok: true, message: `${formatPrice(parsed.data.amount)} kaydedildi.` };
}

export async function deleteLedgerEntryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ entryId: z.uuid() }), form);
  if (!parsed.ok) return { error: "Geçersiz istek. Sayfayı yenileyin." };
  try {
    await deleteLedgerEntry(parsed.data.entryId, ctx);
  } catch (e) {
    return errorState(e, undefined, "gelir-gider-sil");
  }
  refresh();
  return { ok: true, message: "Kayıt silindi." };
}

// Fiş satırları istemcide tutulur, tek bir JSON alanı olarak gönderilir; doğrulama serviste
const purchaseForm = z.object({
  kind: z.string().max(20).default(""),
  manufacturerId: z.string().max(60).default(""),
  date: z.string().max(20).default(""),
  note: z.string().max(1000).default(""),
  requestId: z
    .string()
    .max(60)
    .default("")
    .transform((v) => v || null),
  lines: z
    .string()
    .max(200_000, "Fiş çok uzun; bölün.")
    .default("[]")
    .transform((s, ctx) => {
      try {
        const v: unknown = JSON.parse(s);
        if (Array.isArray(v)) return v as unknown[];
      } catch {}
      ctx.addIssue({ code: "custom", message: "Fiş satırları okunamadı. Sayfayı yenileyin." });
      return z.NEVER;
    }),
});

export async function createPurchaseAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(purchaseForm, form);
  if (!parsed.ok) return parsed.state;
  let id: string;
  try {
    ({ id } = await createPurchase(parsed.data as Parameters<typeof createPurchase>[0], ctx));
  } catch (e) {
    // Satırlar istemcide durur; JSON geri gönderilmez
    const { lines: _lines, requestId: _requestId, ...values } = parsed.values;
    return errorState(e, values, "fis-ekle");
  }
  refresh();
  redirect(`/yonetim/muhasebe/fisler/${id}?yeni=1`);
}
