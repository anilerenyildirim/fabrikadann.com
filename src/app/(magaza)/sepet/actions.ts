"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, type FormState } from "@/lib/form";
import { getClientIp } from "@/server/auth/current";
import { rateLimit } from "@/server/auth/rate-limit";
import { getCartOwner } from "@/server/cart-owner";
import { MAX_QTY_PER_LINE, removeLine, setQuantity } from "@/server/services/cart";

const lineSchema = z.object({
  lineId: z.uuid(),
  // 0 satırı sepetten çıkarır
  quantity: z.coerce.number().int().min(0).max(MAX_QTY_PER_LINE),
});

/** Sepet satırının adedini değiştirir ya da (adet 0) satırı çıkarır. Satır başkasının sepetindeyse etkisizdir. */
export async function updateCartLine(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = lineSchema.safeParse(formToObject(form));
  if (!parsed.success) return { error: "Adet güncellenemedi. Sayfayı yenileyip tekrar deneyin." };

  // Sepete ekleme ile aynı kova: IP başına dakikada 60 sepet işlemi
  const limit = await rateLimit(`sepet:${await getClientIp()}`, 60, 60);
  if (!limit.ok) return { error: "Kısa sürede çok fazla işlem yaptınız. Bir dakika bekleyip yeniden deneyin." };

  const owner = await getCartOwner();
  if (!owner) return { error: "Sepetiniz bulunamadı. Sayfayı yenileyin." };

  const { lineId, quantity } = parsed.data;
  const result = quantity === 0 ? await removeLine(owner, lineId) : await setQuantity(owner, lineId, quantity);
  revalidatePath("/", "layout");
  return result.ok ? { ok: true } : { error: result.error };
}
