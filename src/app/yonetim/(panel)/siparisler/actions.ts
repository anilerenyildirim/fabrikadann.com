"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/form";
import { changeOrderStatus, orderStatusSchema } from "@/server/services/admin/orders";
import { adminContext, errorState, parseForm } from "../../_lib/action";

const transitionForm = z.object({
  orderId: z.uuid("Sipariş bulunamadı. Sayfayı yenileyin."),
  to: orderStatusSchema,
  from: orderStatusSchema.optional(),
  carrier: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  carrierOther: z.string().max(200).optional(),
  trackingNumber: z.string().max(200).optional(),
  restock: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

const MESSAGES: Record<string, string> = {
  shipped: "Sipariş kargoya verildi; müşteriye takip numarasıyla e-posta gönderildi.",
  delivered: "Sipariş teslim edildi olarak işaretlendi.",
  cancelled: "Sipariş iptal edildi; ürünler stoğa geri eklendi.",
  refunded: "Sipariş iade edildi olarak işaretlendi.",
};

export async function changeOrderStatusAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(transitionForm, form);
  if (!parsed.ok) return { ...parsed.state, error: parsed.state.error ?? "Geçersiz istek. Sayfayı yenileyin." };
  const { orderId, to, from, carrier, carrierOther, trackingNumber, restock } = parsed.data;
  let mailSent: boolean | null;
  try {
    ({ mailSent } = await changeOrderStatus(
      orderId,
      {
        to,
        carrier: carrier as never,
        carrierOther,
        trackingNumber,
        restock: to === "refunded" ? restock : undefined,
        expectedFrom: from,
      },
      ctx,
    ));
  } catch (e) {
    return errorState(e, parsed.values, "siparis-durum");
  }
  revalidatePath("/yonetim", "layout");
  if (to === "shipped" && mailSent === false) {
    return {
      ok: true,
      message: "Sipariş kargoya verildi, ancak müşteriye e-posta gönderilemedi. Takip numarasını müşteriye ayrıca iletin.",
    };
  }
  if (to === "refunded") {
    return {
      ok: true,
      message: restock ? "İade kaydedildi; ürünler stoğa geri eklendi." : "İade kaydedildi; stok değişmedi.",
    };
  }
  return { ok: true, message: MESSAGES[to] ?? "Kaydedildi." };
}
