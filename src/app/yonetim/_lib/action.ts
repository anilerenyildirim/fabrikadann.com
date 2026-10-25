import "server-only";
import { logError } from "@/server/log";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { fieldErrorsOf, formToObject, safeValues, type FormState } from "@/lib/form";
import { getClientIp, requireAdmin } from "@/server/auth/current";
import { AdminAccessError, AdminError, type AdminContext } from "@/server/services/admin/context";

export const GENERIC_ERROR = "İşlem tamamlanamadı. Sayfayı yenileyip yeniden deneyin; sorun sürerse sunucu kayıtlarına bakın.";

/**
 * Her yönetim Server Action'ı bununla başlar: oturum yoksa ya da iki adımlı doğrulama yapılmamışsa
 * giriş sayfasına yönlendirir. Dönen bağlam servislerde yeniden doğrulanır (assertAdmin).
 */
export async function adminContext(): Promise<AdminContext> {
  const user = await requireAdmin();
  return { actorId: user.id, ip: await getClientIp() };
}

/** Servis hatasını form durumuna çevirir; beklenmeyen hatanın ayrıntısı kullanıcıya gösterilmez. */
export function errorState(e: unknown, values?: Record<string, string>, where = "yonetim"): FormState {
  unstable_rethrow(e);
  if (e instanceof AdminError) {
    return e.field ? { fieldErrors: { [e.field]: e.message }, values } : { error: e.message, values };
  }
  if (e instanceof AdminAccessError) return { error: e.message };
  logError(`[${where}]`, e);
  return { error: GENERIC_ERROR, values };
}

/** FormData'yı zod şemasıyla doğrular. */
export function parseForm<T extends z.ZodType>(
  schemaDef: T,
  form: FormData,
): { ok: true; data: z.output<T>; values: Record<string, string> } | { ok: false; state: FormState } {
  const raw = formToObject(form);
  const values = safeValues(raw);
  const parsed = schemaDef.safeParse(raw);
  if (!parsed.success) return { ok: false, state: { fieldErrors: fieldErrorsOf(parsed.error), values } };
  return { ok: true, data: parsed.data, values };
}
