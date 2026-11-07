"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parsePriceToKurus } from "@/lib/money";
import { rateLimit } from "@/server/auth/rate-limit";
import { AiAssistantError, suggestForProduct, type Suggestion } from "@/server/ai/product-assistant";
import { n11ClientOrError } from "@/server/marketplaces/n11";
import { applySuggestion, type ApplyInput } from "@/server/services/admin/ai-assistant";
import { addColor, createProduct } from "@/server/services/admin/catalog";
import { adminContext, errorState } from "../../_lib/action";

/** Ürünün fotoğraflarından öneri (kaydetmez). */
export async function suggestAction(rawId: unknown): Promise<{ suggestion?: Suggestion; error?: string }> {
  const ctx = await adminContext();
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { error: "Ürün bulunamadı. Sayfayı yenileyin." };
  const limited = await rateLimit(`ai-asistan:${ctx.actorId}`, 60, 3600);
  if (!limited.ok) return { error: `Saatlik öneri sınırına ulaşıldı. ${Math.ceil(limited.retryAfter / 60)} dakika sonra yeniden deneyin.` };
  const n11 = await n11ClientOrError();
  try {
    return { suggestion: await suggestForProduct(ctx, id.data, { n11: "client" in n11 ? n11.client : null }) };
  } catch (e) {
    if (e instanceof AiAssistantError) return { error: e.message };
    return { error: errorState(e, undefined, "ai-asistan").error ?? "Öneri alınamadı. Yeniden deneyin." };
  }
}

/** Yöneticinin seçtiği öneri alanlarını kaydeder. */
export async function applySuggestionAction(rawId: unknown, input: unknown): Promise<{ ok?: true; error?: string }> {
  const ctx = await adminContext();
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { error: "Ürün bulunamadı. Sayfayı yenileyin." };
  try {
    await applySuggestion(ctx, id.data, input as ApplyInput);
  } catch (e) {
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Öneri geçersiz. Yeniden öneri alın." };
    return { error: errorState(e, undefined, "ai-uygula").error ?? "Öneri uygulanamadı." };
  }
  revalidatePath(`/yonetim/urunler/${id.data}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** "Fotoğraflarla başla": fiyatla taslak ürün ve ilk rengi açar; görseller sonra tek tek yüklenir. */
export async function startDraftAction(rawPrice: unknown, rawManufacturerId: unknown): Promise<{ productId?: string; colorId?: string; error?: string }> {
  const ctx = await adminContext();
  const price = typeof rawPrice === "string" ? parsePriceToKurus(rawPrice.trim()) : NaN;
  if (!Number.isFinite(price) || price <= 0) return { error: "Satış fiyatını 1.299,90 biçiminde yazın." };
  const manufacturerId = z.uuid().safeParse(rawManufacturerId);
  if (!manufacturerId.success) return { error: "Üretici seçin. Listede yoksa önce Üreticiler sayfasından ekleyin." };
  try {
    const { id } = await createProduct({ name: "Yeni ürün", price, status: "draft", manufacturerId: manufacturerId.data }, ctx);
    const color = await addColor(id, "Renk 1", ctx);
    revalidatePath("/yonetim/urunler");
    return { productId: id, colorId: color.id };
  } catch (e) {
    const s = errorState(e, undefined, "foto-baslat");
    return { error: s.error ?? Object.values(s.fieldErrors ?? {})[0] ?? "Taslak ürün açılamadı." };
  }
}
