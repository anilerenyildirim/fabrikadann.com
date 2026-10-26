"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/form";
import { adjustVariantStock, type StockAdjustResult } from "@/server/services/admin/catalog";
import { bulkUpdateVariants, type BulkResult } from "@/server/services/admin/bulk-stock";
import { adminContext, errorState, parseForm } from "../../_lib/action";

const adjustForm = z.object({
  variantId: z.uuid("Numara bulunamadı. Sayfayı yenileyin."),
  stock: z
    .string()
    .trim()
    .regex(/^\d{1,6}$/, "Yeni stok için 0 ya da daha büyük bir tam sayı yazın.")
    .transform(Number),
  note: z.string().max(400).default(""),
  // Ekranda görülen satılabilir stok: bu arada sipariş geldiyse üzerine yazılmasın
  expected: z
    .string()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .optional(),
  mode: z.enum(["available", "physical"]).default("available"),
});

/** Elle stok düzeltmesi (sebep zorunlu); stok sayfasında ve ürün düzenleme sayfasında kullanılır. */
export async function adjustStockAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(adjustForm, form);
  if (!parsed.ok) return parsed.state;
  const { variantId, stock, note, expected, mode } = parsed.data;
  let result: StockAdjustResult;
  try {
    result = await adjustVariantStock(variantId, stock, note, ctx, { expected: mode === "available" ? expected : undefined, mode });
  } catch (e) {
    return errorState(e, parsed.values, "stok-duzelt");
  }
  revalidatePath("/", "layout");
  const change = result.from === result.to ? "Satılabilir stok değişmedi" : `Satılabilir stok ${result.from} → ${result.to}`;
  if (mode === "physical") {
    const detail = `${change} (sayım ${stock}, bekleyen siparişlerde ${result.reserved}).`;
    return {
      ok: true,
      message:
        result.shortfall > 0
          ? `${detail} Dikkat: bekleyen siparişler için ${result.shortfall} çift eksik.`
          : detail,
    };
  }
  return { ok: true, message: `${change}.` };
}

export type BulkState = FormState & { result?: BulkResult };

const bulkForm = z.object({
  satirlar: z.string().max(200_000, "En fazla 200.000 karakter yapıştırabilirsiniz; listeyi bölün."),
  mode: z.enum(["available", "physical"]).default("physical"),
  note: z.string().max(400).default(""),
  islem: z.enum(["onizle", "uygula"]).default("onizle"),
});

/** Toplu barkod/stok: "onizle" yalnızca kontrol eder, "uygula" hatasızsa hepsini birlikte yazar. */
export async function bulkStockAction(_prev: BulkState, form: FormData): Promise<BulkState> {
  const ctx = await adminContext();
  const parsed = parseForm(bulkForm, form);
  if (!parsed.ok) return parsed.state;
  const { satirlar, mode, note, islem } = parsed.data;
  let result: BulkResult;
  try {
    result = await bulkUpdateVariants({ text: satirlar, mode, note, apply: islem === "uygula" }, ctx);
  } catch (e) {
    return errorState(e, parsed.values, "toplu-stok");
  }
  if (result.applied) {
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `${result.barcodeChanges} barkod ve ${result.stockChanges} stok güncellendi.`,
      values: parsed.values,
      result,
    };
  }
  return { values: parsed.values, result };
}
