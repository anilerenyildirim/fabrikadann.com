"use server";

import { logError } from "@/server/log";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formToObject, type FormState } from "@/lib/form";
import { getClientIp } from "@/server/auth/current";
import { rateLimit } from "@/server/auth/rate-limit";
import { getAccessibleOrder, ORDER_NUMBER_RE } from "@/server/guest-orders";
import { PaymentError, startPayment } from "@/server/services/payments";
import { appUrl, paymentRedirectTarget } from "../../odeme/_lib/payment";

const retrySchema = z.object({ number: z.string().regex(ORDER_NUMBER_RE) });

/** Ödemesi bekleyen sipariş için yeni ödeme denemesi açar. Erişim her seferinde yeniden denetlenir. */
export async function retryPayment(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = retrySchema.safeParse(formToObject(form));
  if (!parsed.success) return { error: "Sipariş bulunamadı." };

  const ip = await getClientIp();
  const limit = await rateLimit(`odeme:${ip}`, 10, 600);
  if (!limit.ok) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfter / 60));
    return { error: `Kısa sürede çok sayıda ödeme denemesi yapıldı. ${minutes} dakika sonra tekrar deneyin.` };
  }

  // Yalnızca sahibi (üye) ya da bu tarayıcıdaki misafir token'ı
  const order = await getAccessibleOrder(parsed.data.number);
  if (!order) return { error: "Sipariş bulunamadı." };
  if (order.status !== "awaiting_payment") {
    return { error: "Bu sipariş için ödeme beklenmiyor. Güncel durumu görmek için sayfayı yenileyin." };
  }

  const orderPage = `/siparis/${order.number}`;
  let target: string;
  try {
    const { redirectUrl } = await startPayment(order.id, { appUrl: appUrl(), ip });
    target = paymentRedirectTarget(redirectUrl, orderPage);
  } catch (e) {
    if (e instanceof PaymentError) {
      return {
        error: "Bu siparişin ödeme süresi doldu. Ürünleri yeniden sepete ekleyip yeni sipariş oluşturabilirsiniz.",
      };
    }
    logError("Ödeme yeniden başlatılamadı", e);
    return { error: "Ödeme sayfası şu an açılamadı. Birkaç dakika sonra tekrar deneyin." };
  }
  redirect(target);
}
