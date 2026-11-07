"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/form";
import { rateLimit } from "@/server/auth/rate-limit";
import { checkIntegrations } from "@/server/integrations/health";
import { defaultTesters } from "@/server/integrations/testers";
import { SecretsError } from "@/server/secrets";
import { clearIntegrationKeys, INTEGRATIONS, saveIntegrationKeys, setIntegrationExpiry, type IntegrationId } from "@/server/services/admin/integrations";
import { adminContext, errorState } from "../../../_lib/action";

const PATH = "/yonetim/ayarlar/api-anahtarlari";
const idSchema = z.enum(INTEGRATIONS.map((i) => i.id) as [IntegrationId, ...IntegrationId[]]);

export async function saveKeysAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return { error: "Bağlantı bulunamadı. Sayfayı yenileyin." };
  const limited = await rateLimit(`api-anahtar:${ctx.actorId}`, 30, 3600);
  if (!limited.ok) return { error: "Çok sık denendi. Bir saat sonra yeniden deneyin." };
  const values: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) if (k !== "id" && typeof v === "string") values[k] = v;
  try {
    await saveIntegrationKeys(ctx, id.data, values, defaultTesters);
  } catch (e) {
    if (e instanceof SecretsError) return { error: e.message };
    // Parola alanları geri doldurulmaz (values verilmez)
    return errorState(e, undefined, "api-anahtar");
  }
  revalidatePath(PATH);
  return { ok: true, message: "Anahtar denendi, çalışıyor ve kaydedildi." };
}

export async function clearKeysAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return { error: "Bağlantı bulunamadı. Sayfayı yenileyin." };
  try {
    await clearIntegrationKeys(ctx, id.data);
  } catch (e) {
    return errorState(e, undefined, "api-anahtar-sil");
  }
  revalidatePath(PATH);
  return { ok: true, message: "Paneldeki anahtar kaldırıldı; varsa sunucu dosyasındaki kullanılır." };
}

export async function setExpiryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return { error: "Bağlantı bulunamadı. Sayfayı yenileyin." };
  const raw = String(form.get("expiresAt") ?? "").trim();
  try {
    await setIntegrationExpiry(ctx, id.data, raw || null);
  } catch (e) {
    return errorState(e, { expiresAt: raw }, "api-anahtar-tarih");
  }
  revalidatePath(PATH);
  return { ok: true, message: raw ? "Son kullanma tarihi kaydedildi; 7, 3 ve 1 gün kala bildirim gelir." : "Son kullanma tarihi kaldırıldı." };
}

export async function checkNowAction(_prev: FormState, _form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const limited = await rateLimit(`api-kontrol:${ctx.actorId}`, 20, 3600);
  if (!limited.ok) return { error: "Çok sık denendi. Biraz sonra yeniden deneyin." };
  await checkIntegrations();
  revalidatePath(PATH);
  return { ok: true, message: "Bağlantılar denendi." };
}
