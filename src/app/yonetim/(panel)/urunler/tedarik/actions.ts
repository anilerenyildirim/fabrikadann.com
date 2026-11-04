"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, safeValues, type FormState } from "@/lib/form";
import { parsePriceToKurus } from "@/lib/money";
import { bulkUpdateSupply, MAX_SUPPLY_ROWS, type SupplyUpdate } from "@/server/services/admin/supply";
import { adminContext, errorState } from "../../../_lib/action";

const ids = z.array(z.uuid()).min(1).max(MAX_SUPPLY_ROWS);
const optionalUuid = z.union([z.literal(""), z.uuid()]);

/** Toplu üretici ve alış fiyatı: her satır `id`, `m-<id>` (üretici) ve `p-<id>` (alış fiyatı, TL). */
export async function saveSupplyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const values = safeValues(formToObject(form));
  const parsedIds = ids.safeParse(form.getAll("id"));
  if (!parsedIds.success) return { error: "Liste geçersiz. Sayfayı yenileyip yeniden deneyin." };

  const rows: SupplyUpdate[] = [];
  const fieldErrors: Record<string, string> = {};
  for (const id of parsedIds.data) {
    const m = optionalUuid.safeParse(String(form.get(`m-${id}`) ?? ""));
    if (!m.success) {
      fieldErrors[`satir-${id}`] = "Üreticiyi listeden yeniden seçin.";
      continue;
    }
    const priceText = String(form.get(`p-${id}`) ?? "").trim();
    let purchasePrice: number | null = null;
    if (priceText) {
      purchasePrice = parsePriceToKurus(priceText);
      if (Number.isNaN(purchasePrice)) {
        fieldErrors[`satir-${id}`] = "Alış fiyatını 850,00 biçiminde yazın ya da boş bırakın.";
        continue;
      }
    }
    rows.push({ productId: id, manufacturerId: m.data || null, purchasePrice });
  }
  if (Object.keys(fieldErrors).length) {
    return { error: "İşaretli satırları düzeltin; hiçbir değişiklik kaydedilmedi.", fieldErrors, values };
  }

  let changed: number;
  try {
    ({ changed } = await bulkUpdateSupply(rows, ctx));
  } catch (e) {
    const state = errorState(e, values, "tedarik-toplu");
    return state.fieldErrors ? { ...state, error: "İşaretli satırı düzeltin; hiçbir değişiklik kaydedilmedi." } : state;
  }
  revalidatePath("/yonetim", "layout");
  return {
    ok: true,
    message: changed === 0 ? "Değişiklik yok." : `${changed} ürünün bilgisi kaydedildi.`,
  };
}
