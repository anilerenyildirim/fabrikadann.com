import { and, eq, isNull, lt, or } from "drizzle-orm";
import { Secret, TOTP } from "otpauth";
import { db, schema } from "@/server/db";

const PERIOD = 30;

function totpFor(secret: string, label = "yonetici") {
  return new TOTP({
    issuer: "fabrikadann",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: PERIOD,
    secret: Secret.fromBase32(secret),
  });
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(secret: string, email: string): string {
  return totpFor(secret, email).toString();
}

/** Test ve kurulum betiği için: şu anki kod. */
export function currentTotp(secret: string): string {
  return totpFor(secret).generate();
}

/**
 * Kodu doğrular ve kullanılan zaman adımını kaydeder; aynı kod (ya da daha eski bir adımın kodu)
 * ikinci kez kabul edilmez.
 */
export async function verifyTotpForUser(userId: string, secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const delta = totpFor(secret).validate({ token: code, window: 1 });
  if (delta === null) return false;
  const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
  const updated = await db
    .update(schema.users)
    .set({ totpLastStep: step })
    .where(
      and(
        eq(schema.users.id, userId),
        or(isNull(schema.users.totpLastStep), lt(schema.users.totpLastStep, step)),
      ),
    )
    .returning({ id: schema.users.id });
  return updated.length === 1;
}
