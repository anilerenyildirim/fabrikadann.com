"use server";

import { logError } from "@/server/log";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/form";
import { getClientIp } from "@/server/auth/current";
import { rateLimit } from "@/server/auth/rate-limit";
import { getOrCreateCartOwner } from "@/server/cart-owner";
import { addToCart, MAX_QTY_PER_LINE } from "@/server/services/cart";

const addSchema = z.object({
  variantId: z.uuid({ error: "Önce numaranızı seçin." }),
  quantity: z.coerce
    .number({ error: "Adet geçersiz." })
    .int({ error: "Adet geçersiz." })
    .min(1, { error: "Adet geçersiz." })
    .max(MAX_QTY_PER_LINE, { error: `Bir üründen en fazla ${MAX_QTY_PER_LINE} adet alınabilir.` })
    .default(1),
});

/** Ürün sayfasındaki "Sepete ekle". Fiyat istemciden alınmaz; yalnızca varyant ve adet. */
export async function addToCartAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = addSchema.safeParse({
    variantId: formData.get("variantId") ?? undefined,
    quantity: formData.get("quantity") ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.message ?? "Önce numaranızı seçin.";
    return { ok: false, error: message, fieldErrors: { [String(issue?.path[0] ?? "variantId")]: message } };
  }

  // Veritabanı hatası sayfayı hata ekranına düşürmesin; ayrıntı yalnızca sunucu günlüğüne
  try {
    const limit = await rateLimit(`sepet:${await getClientIp()}`, 60, 60);
    if (!limit.ok) {
      return { ok: false, error: "Kısa sürede çok fazla işlem yaptınız. Bir dakika bekleyip yeniden deneyin." };
    }
    const owner = await getOrCreateCartOwner();
    const result = await addToCart(owner, parsed.data.variantId, parsed.data.quantity);
    if (!result.ok) return { ok: false, error: result.error };
  } catch (error) {
    logError("Sepete ekleme başarısız", error);
    return { ok: false, error: "Ürün sepete eklenemedi. Sayfayı yenileyip yeniden deneyin." };
  }

  // Başlıktaki sepet sayısı layout'ta hesaplanıyor
  revalidatePath("/", "layout");
  return { ok: true, message: "Sepete eklendi." };
}
