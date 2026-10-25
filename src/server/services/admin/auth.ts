import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { rateLimit } from "@/server/auth/rate-limit";
import { verifyTotpForUser } from "@/server/auth/totp";
import { authenticate, normalizeEmail } from "../accounts";
import { audit } from "../audit";

export const ADMIN_LOGIN_ERROR = "E-posta ya da parola hatalı.";
export const ADMIN_NO_TOTP_ERROR = "İki adımlı doğrulama kurulmamış; scripts/create-admin.ts ile kurun.";
export const TOTP_ERROR = "Kod geçersiz ya da süresi dolmuş. Uygulamadaki güncel 6 haneli kodu girin.";

export type AdminStepResult = { ok: true; userId: string } | { ok: false; error: string };

function tooMany(retryAfter: number): AdminStepResult {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return { ok: false, error: `Çok fazla deneme yapıldı. ${minutes} dakika sonra yeniden deneyin.` };
}

/**
 * Yönetim girişinin parola adımı. Kullanıcı yoksa, parola yanlışsa ya da rolü admin değilse aynı
 * mesaj döner (hesap numaralandırma yok). Başarıda oturum açmak çağırana kalır.
 */
export async function adminPasswordStep(email: string, password: string, ip: string): Promise<AdminStepResult> {
  const normalized = normalizeEmail(email).slice(0, 254);
  const byIp = await rateLimit(`yonetim-giris:ip:${ip}`, 10, 900);
  if (!byIp.ok) return tooMany(byIp.retryAfter);
  const byEmail = await rateLimit(`yonetim-giris:eposta:${normalized}`, 5, 900);
  if (!byEmail.ok) return tooMany(byEmail.retryAfter);

  const user = await authenticate(normalized, password);
  if (!user || user.role !== "admin") {
    await audit({ action: "admin.login.failed", actorId: user?.id ?? null, target: normalized, ip });
    return { ok: false, error: ADMIN_LOGIN_ERROR };
  }
  if (!user.totpSecret) {
    await audit({ action: "admin.login.no_totp", actorId: user.id, target: normalized, ip });
    return { ok: false, error: ADMIN_NO_TOTP_ERROR };
  }
  await audit({ action: "admin.login.password", actorId: user.id, target: normalized, ip });
  return { ok: true, userId: user.id };
}

/** İkinci adım: TOTP kodu. Aynı kod iki kez kabul edilmez (verifyTotpForUser). */
export async function adminTotpStep(userId: string, code: string, ip: string): Promise<AdminStepResult> {
  const limited = await rateLimit(`totp:${userId}`, 5, 300);
  if (!limited.ok) return tooMany(limited.retryAfter);
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { id: true, role: true, totpSecret: true },
  });
  if (!user || user.role !== "admin" || !user.totpSecret) return { ok: false, error: ADMIN_NO_TOTP_ERROR };
  const cleaned = code.replace(/\s+/g, "");
  const ok = await verifyTotpForUser(user.id, user.totpSecret, cleaned);
  await audit({ action: ok ? "admin.login.totp" : "admin.login.totp_failed", actorId: user.id, ip });
  return ok ? { ok: true, userId: user.id } : { ok: false, error: TOTP_ERROR };
}
