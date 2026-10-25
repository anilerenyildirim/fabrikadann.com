import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { stripControl } from "@/lib/text";
import { randomToken, sha256 } from "@/server/auth/crypto";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "@/server/auth/password";
import { deleteUserSessions } from "@/server/auth/session";
import { sendMail } from "@/server/mail";

const RESET_TTL_MS = 60 * 60 * 1000;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .email("Geçerli bir e-posta adresi girin.")
  .transform(normalizeEmail);

export const nameSchema = z
  .string()
  .transform(stripControl)
  .pipe(z.string().trim().min(1, "Bu alan zorunlu.").max(60));

export type RegisterInput = { email: string; password: string; firstName: string; lastName: string };

export type AccountResult<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

/**
 * Kayıt sonucu. Arayüz iki durumda da AYNI yanıtı verir ("doğrulama bağlantısı gönderdik"); fark yalnızca
 * gönderilen e-postada: yeni hesaba doğrulama bağlantısı, var olan hesabın sahibine bilgilendirme.
 * Böylece kayıt formu bir e-postanın kayıtlı olup olmadığını açığa vermez.
 */
export type RegisterOutcome = { created: true; id: string; email: string } | { created: false; email: string };

export async function registerCustomer(input: RegisterInput): Promise<AccountResult<RegisterOutcome>> {
  const email = normalizeEmail(input.email);
  const problem = passwordProblem(input.password, { email });
  if (problem) return { ok: false, error: problem, field: "password" };
  // Parola özeti her iki durumda da hesaplanır (yanıt süresi e-postanın varlığını ele vermesin)
  const passwordHash = await hashPassword(input.password);
  const inserted = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      role: "customer",
    })
    .onConflictDoNothing({ target: schema.users.email })
    .returning({ id: schema.users.id });
  if (inserted.length === 0) return { ok: true, value: { created: false, email } };
  return { ok: true, value: { created: true, id: inserted[0]!.id, email } };
}

const VERIFY_TTL_MS = 48 * 60 * 60 * 1000;

/** Kayıt sonrası e-postası: yeni hesaba doğrulama bağlantısı, var olan hesaba bilgilendirme. */
export async function sendRegistrationEmail(outcome: RegisterOutcome, appUrl: string): Promise<void> {
  if (outcome.created) {
    await sendVerificationEmail(outcome.id, appUrl);
    return;
  }
  await sendMail({
    to: outcome.email,
    subject: "fabrikadann — bu e-postayla zaten hesabınız var",
    text: [
      "Merhaba,",
      "",
      "Bu e-posta adresiyle fabrikadann.com'da yeni bir hesap açılmak istendi, ancak zaten bir hesabınız var.",
      `Giriş yapmak için: ${appUrl}/giris`,
      `Parolanızı hatırlamıyorsanız: ${appUrl}/sifremi-unuttum`,
      "",
      "Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; hesabınızda hiçbir değişiklik yapılmadı.",
    ].join("\n"),
  });
}

/** Doğrulama bağlantısı üretip gönderir; önceki kullanılmamış bağlantılar geçersiz olur. */
export async function sendVerificationEmail(userId: string, appUrl: string): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user || user.emailVerifiedAt) return null;
  const token = randomToken();
  await db.delete(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, user.id));
  await db.insert(schema.emailVerificationTokens).values({
    idHash: sha256(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  });
  await sendMail({
    to: user.email,
    subject: "fabrikadann — e-posta adresinizi doğrulayın",
    text: [
      `Merhaba ${user.firstName},`,
      "",
      "Hesabınızı etkinleştirmek için aşağıdaki bağlantıyı açın ve \"Hesabımı etkinleştir\"e dokunun.",
      "Bağlantı 48 saat geçerlidir.",
      `${appUrl}/hesap-dogrula/${token}`,
      "",
      "Bu hesabı siz açmadıysanız bu e-postayı yok sayabilirsiniz.",
    ].join("\n"),
  });
  return token;
}

/** Doğrulama bağlantısını tek kullanımlık olarak tüketir; başarıda kullanıcıyı döner. */
export async function verifyEmail(token: string): Promise<{ id: string; role: "customer" | "admin" } | null> {
  if (!token || token.length > 100) return null;
  const now = new Date();
  const [consumed] = await db
    .update(schema.emailVerificationTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.emailVerificationTokens.idHash, sha256(token)),
        isNull(schema.emailVerificationTokens.usedAt),
        gt(schema.emailVerificationTokens.expiresAt, now),
      ),
    )
    .returning({ userId: schema.emailVerificationTokens.userId });
  if (!consumed) return null;
  const [user] = await db
    .update(schema.users)
    .set({ emailVerifiedAt: now })
    .where(eq(schema.users.id, consumed.userId))
    .returning({ id: schema.users.id, role: schema.users.role });
  return user ?? null;
}

/** E-posta ve parola doğruysa kullanıcıyı döner; değilse null (her iki durumda da benzer süre). */
export async function authenticate(email: string, password: string) {
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, normalizeEmail(email)) });
  if (!user) {
    await burnPasswordCheck(password);
    return null;
  }
  return (await verifyPassword(user.passwordHash, password)) ? user : null;
}

/**
 * Hesap varsa sıfırlama bağlantısı gönderir. Hesap olup olmadığını çağırana söylemez;
 * test ve iç kullanım için oluşturulan token'ı döner.
 */
export async function requestPasswordReset(email: string, appUrl: string): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, normalizeEmail(email)) });
  if (!user) return null;
  const token = randomToken();
  // Önceki kullanılmamış bağlantılar geçersiz olsun
  await db.delete(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.userId, user.id));
  await db.insert(schema.passwordResetTokens).values({
    idHash: sha256(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  await sendMail({
    to: user.email,
    subject: "fabrikadann — parola sıfırlama",
    text: [
      `Merhaba ${user.firstName},`,
      "",
      "Parolanızı sıfırlamak için aşağıdaki bağlantıyı kullanın. Bağlantı 1 saat geçerlidir.",
      `${appUrl}/sifre-sifirla/${token}`,
      "",
      "Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; parolanız değişmez.",
    ].join("\n"),
  });
  return token;
}

export async function resetPassword(token: string, newPassword: string): Promise<AccountResult<null>> {
  const row = await db.query.passwordResetTokens.findFirst({
    where: and(
      eq(schema.passwordResetTokens.idHash, sha256(token)),
      isNull(schema.passwordResetTokens.usedAt),
      gt(schema.passwordResetTokens.expiresAt, new Date()),
    ),
  });
  if (!row) return { ok: false, error: "Bağlantı geçersiz ya da süresi dolmuş. Yeni bir bağlantı isteyin." };
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) });
  if (!user) return { ok: false, error: "Bağlantı geçersiz ya da süresi dolmuş. Yeni bir bağlantı isteyin." };
  const problem = passwordProblem(newPassword, { email: user.email });
  if (problem) return { ok: false, error: problem, field: "password" };

  // Token'ı atomik olarak tüket; aynı anda iki istek gelirse yalnızca biri geçer
  const consumed = await db
    .update(schema.passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.passwordResetTokens.idHash, row.idHash), isNull(schema.passwordResetTokens.usedAt)))
    .returning({ userId: schema.passwordResetTokens.userId });
  if (consumed.length === 0) return { ok: false, error: "Bağlantı zaten kullanılmış." };

  await db
    .update(schema.users)
    // Sıfırlama bağlantısını açabilmek e-posta sahipliğini de kanıtlar
    .set({ passwordHash: await hashPassword(newPassword), emailVerifiedAt: user.emailVerifiedAt ?? new Date() })
    .where(eq(schema.users.id, user.id));
  await deleteUserSessions(user.id);
  return { ok: true, value: null };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<AccountResult<null>> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    return { ok: false, error: "Mevcut parola yanlış.", field: "currentPassword" };
  }
  const problem = passwordProblem(newPassword, { email: user.email });
  if (problem) return { ok: false, error: problem, field: "newPassword" };
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(schema.users.id, userId));
  await deleteUserSessions(userId);
  return { ok: true, value: null };
}

export async function updateProfile(
  userId: string,
  input: { firstName: string; lastName: string; phone: string | null },
): Promise<void> {
  await db
    .update(schema.users)
    .set({ firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone: input.phone })
    .where(eq(schema.users.id, userId));
}
