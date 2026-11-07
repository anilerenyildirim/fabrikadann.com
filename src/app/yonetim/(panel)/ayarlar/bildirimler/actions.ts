"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/form";
import { rateLimit } from "@/server/auth/rate-limit";
import { dispatchPending } from "@/server/notifications/dispatch";
import { logError } from "@/server/log";
import { removeSubscription, saveSubscription, sendTestNotification } from "@/server/services/admin/notifications";
import { adminContext, errorState } from "../../../_lib/action";

const TOO_MANY = "Çok sık denendi. Bir saat sonra yeniden deneyin.";

async function limited(userId: string) {
  return !(await rateLimit(`bildirim:${userId}`, 30, 3600)).ok;
}

/** Tarayıcının PushSubscription.toJSON() çıktısı; doğrulama serviste. */
export async function subscribeAction(json: unknown): Promise<{ ok: true } | { error: string }> {
  const ctx = await adminContext();
  if (await limited(ctx.actorId)) return { error: TOO_MANY };
  try {
    await saveSubscription(ctx, json, (await headers()).get("user-agent"));
  } catch (e) {
    const state = errorState(e, undefined, "bildirimler");
    return { error: state.error ?? "Bildirimler açılamadı. Sayfayı yenileyip yeniden deneyin." };
  }
  revalidatePath("/yonetim/ayarlar/bildirimler");
  return { ok: true };
}

export async function unsubscribeAction(endpoint: unknown): Promise<{ ok: true }> {
  const ctx = await adminContext();
  const parsed = z.string().max(1000).safeParse(endpoint);
  if (parsed.success) await removeSubscription(ctx, { endpoint: parsed.data });
  revalidatePath("/yonetim/ayarlar/bildirimler");
  return { ok: true };
}

export async function removeDeviceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Cihaz bulunamadı. Sayfayı yenileyin." };
  const removed = await removeSubscription(ctx, { id: id.data });
  revalidatePath("/yonetim/ayarlar/bildirimler");
  return removed ? { ok: true, message: "Cihaz kaldırıldı; artık bildirim almayacak." } : { error: "Cihaz bulunamadı. Sayfayı yenileyin." };
}

export async function sendTestAction(_prev: FormState, _form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  if (await limited(ctx.actorId)) return { error: TOO_MANY };
  try {
    await sendTestNotification(ctx);
  } catch (e) {
    return errorState(e, undefined, "bildirimler");
  }
  const result = await dispatchPending().catch((e) => {
    logError("Deneme bildirimi gönderilemedi", e);
    return null;
  });
  revalidatePath("/yonetim/ayarlar/bildirimler");
  if (!result) return { error: "Deneme bildirimi gönderilemedi. Birkaç dakika sonra yeniden deneyin." };
  return { ok: true, message: "Deneme bildirimi gönderildi. Birkaç saniye içinde telefonunuza gelmeli." };
}
