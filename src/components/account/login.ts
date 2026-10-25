import "server-only";
import { rateLimit } from "@/server/auth/rate-limit";
import { authenticate } from "@/server/services/accounts";
import { audit } from "@/server/services/audit";
import { LOGIN_FAILED, tooManyAttempts } from "./schemas";

/*
  Giriş denemesinin çerezden bağımsız kısmı (hız sınırı + parola kontrolü).
  Server Action'dan ayrı tutuldu: "use server" dosyasından dışa açılan her fonksiyon
  istemciden çağrılabilir, IP gibi bir parametre alan bu fonksiyon orada olmamalı.
*/

export const LOGIN_LIMITS = {
  ip: { limit: 20, windowSec: 15 * 60 },
  email: { limit: 8, windowSec: 15 * 60 },
} as const;

type LoginUser = NonNullable<Awaited<ReturnType<typeof authenticate>>>;

export type LoginAttempt = { ok: true; user: Pick<LoginUser, "id" | "role"> } | { ok: false; error: string };

/** email zaten normalize edilmiş (emailSchema) olmalı. */
export async function attemptLogin(email: string, password: string, ip: string): Promise<LoginAttempt> {
  const byIp = await rateLimit(`giris:ip:${ip}`, LOGIN_LIMITS.ip.limit, LOGIN_LIMITS.ip.windowSec);
  if (!byIp.ok) return { ok: false, error: tooManyAttempts(byIp.retryAfter) };
  const byEmail = await rateLimit(`giris:eposta:${email}`, LOGIN_LIMITS.email.limit, LOGIN_LIMITS.email.windowSec);
  if (!byEmail.ok) return { ok: false, error: tooManyAttempts(byEmail.retryAfter) };

  const user = await authenticate(email, password);
  if (!user) return { ok: false, error: LOGIN_FAILED };
  if (user.role === "admin") {
    /*
      Yönetici hesabı yalnızca /yonetim/giris'ten (daha sıkı sınır, denetim kaydı, ardından TOTP)
      oturum açar; mağaza girişi ikinci bir parola deneme kapısı olmasın. Yanıt yanlış parolayla
      aynı: parolanın doğru olduğu buradan anlaşılmaz. Doğru parolayla gelinmesi yönetici için
      önemli bir işaret olduğundan işlem günlüğüne yazılır.
    */
    await audit({ action: "admin.login.store_rejected", actorId: user.id, target: email, ip });
    return { ok: false, error: LOGIN_FAILED };
  }
  return { ok: true, user: { id: user.id, role: user.role } };
}

export const REGISTER_LIMIT = { limit: 5, windowSec: 60 * 60 } as const;

export const FORGOT_LIMITS = {
  ip: { limit: 5, windowSec: 15 * 60 },
  email: { limit: 3, windowSec: 60 * 60 },
} as const;

/** Sıfırlama bağlantısını yeni parolayla kullanma (argon2 maliyetli). */
export const RESET_LIMIT = { limit: 10, windowSec: 15 * 60 } as const;

/** Oturum açmışken parola değiştirme: mevcut parolanın tahminine karşı. */
export const CHANGE_PASSWORD_LIMIT = { limit: 10, windowSec: 15 * 60 } as const;
