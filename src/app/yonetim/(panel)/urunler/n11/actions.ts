"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rateLimit } from "@/server/auth/rate-limit";
import { n11ClientOrError } from "@/server/marketplaces/n11";
import { sendProductToN11, type SendResult } from "@/server/services/admin/n11";
import { adminContext, errorState } from "../../../_lib/action";

export type SendOneState = { result?: SendResult; error?: string };

/** Tek ürünü N11'e gönderir; sayfa seçilenleri sırayla tek tek çağırır (ilerleme gösterilir, zaman aşımı olmaz). */
export async function sendToN11Action(rawId: unknown): Promise<SendOneState> {
  const ctx = await adminContext();
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { error: "Gönderilecek ürünü seçin." };
  const limited = await rateLimit(`n11-gonder:${ctx.actorId}`, 200, 3600);
  if (!limited.ok) return { error: `Çok sık gönderim yapıldı. ${limited.retryAfter} saniye sonra yeniden deneyin.` };
  const c = await n11ClientOrError();
  if ("error" in c) return { error: c.error };
  try {
    const result = await sendProductToN11(ctx, c.client, id.data);
    revalidatePath("/yonetim/urunler/n11");
    return { result };
  } catch (e) {
    return { error: errorState(e, undefined, "n11-gonder").error ?? "Ürün gönderilemedi." };
  }
}
