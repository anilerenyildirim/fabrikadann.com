import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { sha256 } from "@/server/auth/crypto";
import { passwordProblem } from "@/server/auth/password";
import { rateLimit } from "@/server/auth/rate-limit";
import { createSession, validateSessionToken } from "@/server/auth/session";
import { currentTotp, generateTotpSecret, verifyTotpForUser } from "@/server/auth/totp";
import {
  authenticate,
  changePassword,
  registerCustomer,
  requestPasswordReset,
  resetPassword,
} from "@/server/services/accounts";
import { resetDb } from "../helpers/db";

beforeEach(resetDb);

const PW = "Kuvvetli-Parola-42";

async function register(email = "Ayse@Ornek.com") {
  const r = await registerCustomer({ email, password: PW, firstName: "Ayşe", lastName: "Yılmaz" });
  if (!r.ok || !r.value.created) throw new Error("kayıt başarısız");
  // Testlerde e-posta doğrulaması atlanır
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, r.value.id));
  return r.value.id;
}

test("kayıt e-postayı küçültür; aynı e-postayla ikinci kayıt hesap açmaz ve bunu yanıtta ele vermez", async () => {
  await register();
  const again = await registerCustomer({ email: "ayse@ornek.com ", password: PW, firstName: "A", lastName: "B" });
  expect(again).toEqual({ ok: true, value: { created: false, email: "ayse@ornek.com" } });
  expect(await db.select().from(schema.users)).toHaveLength(1);
});

test("yeni hesap doğrulanana kadar giriş yapamaz; bağlantı tek kullanımlık", async () => {
  const { sendVerificationEmail, verifyEmail } = await import("@/server/services/accounts");
  const { attemptLogin } = await import("@/components/account/login");
  const r = await registerCustomer({ email: "yeni@ornek.com", password: PW, firstName: "Yeni", lastName: "Kişi" });
  if (!r.ok || !r.value.created) throw new Error("kayıt başarısız");
  const blocked = await attemptLogin("yeni@ornek.com", PW, "10.9.9.9");
  expect(blocked.ok).toBe(false);
  // Yanlış parolayla aynı mesaj (hesabın varlığı anlaşılmasın)
  const wrong = await attemptLogin("yeni@ornek.com", "Baska-Guclu-Parola-8", "10.9.9.8");
  if (!blocked.ok && !wrong.ok) expect(blocked.error).toBe(wrong.error);
  const token = (await sendVerificationEmail(r.value.id, "http://x"))!;
  expect(await verifyEmail("uydurma")).toBeNull();
  expect(await verifyEmail(token)).toEqual({ id: r.value.id, role: "customer" });
  expect(await verifyEmail(token)).toBeNull();
  expect((await attemptLogin("yeni@ornek.com", PW, "10.9.9.9")).ok).toBe(true);
});

test("doğru parola girer, yanlış ve bilinmeyen e-posta girmez", async () => {
  await register();
  expect(await authenticate("AYSE@ornek.com", PW)).not.toBeNull();
  expect(await authenticate("ayse@ornek.com", "yanlis-parola-1")).toBeNull();
  expect(await authenticate("yok@ornek.com", PW)).toBeNull();
});

test("parola kuralları", () => {
  expect(passwordProblem("kisa")).toMatch(/en az 10/);
  expect(passwordProblem("1234567890")).toMatch(/yaygın/);
  expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/yaygın/);
  expect(passwordProblem("ayseyilmaz2024", { email: "ayseyilmaz@x.com" })).toMatch(/e-posta/);
  expect(passwordProblem(PW)).toBeNull();
});

test("oturum token'ı veritabanında yalnızca özet olarak durur ve süresi dolunca geçersizdir", async () => {
  const userId = await register();
  const { token } = await createSession(userId, "customer");
  const rows = await db.select().from(schema.sessions);
  expect(rows[0]!.idHash).toBe(sha256(token));
  expect(rows[0]!.idHash).not.toContain(token);
  expect((await validateSessionToken(token))?.user.id).toBe(userId);

  await db.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) });
  expect(await validateSessionToken(token)).toBeNull();
  expect(await validateSessionToken("uydurma")).toBeNull();
});

test("hız sınırı limiti aşınca reddeder", async () => {
  for (let i = 0; i < 5; i++) expect((await rateLimit("giris:1.2.3.4", 5, 60)).ok).toBe(true);
  const sixth = await rateLimit("giris:1.2.3.4", 5, 60);
  expect(sixth.ok).toBe(false);
  expect(sixth.retryAfter).toBeGreaterThan(0);
  expect((await rateLimit("giris:5.6.7.8", 5, 60)).ok).toBe(true);
});

test("hız sınırı eşzamanlı isteklerde sayaç atlamaz", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => rateLimit("yaris", 5, 60)));
  expect(results.filter((r) => r.ok)).toHaveLength(5);
});

test("parola sıfırlama: tek kullanımlık, oturumları düşürür, bilinmeyen e-postada sessiz", async () => {
  const userId = await register();
  const { token: sessionToken } = await createSession(userId, "customer");
  expect(await requestPasswordReset("yok@ornek.com", "http://x")).toBeNull();

  const token = (await requestPasswordReset("ayse@ornek.com", "http://x"))!;
  expect((await resetPassword(token, "Yeni-Guclu-Parola-7")).ok).toBe(true);
  expect((await resetPassword(token, "Baska-Guclu-Parola-8")).ok).toBe(false);
  expect(await validateSessionToken(sessionToken)).toBeNull();
  expect(await authenticate("ayse@ornek.com", "Yeni-Guclu-Parola-7")).not.toBeNull();
});

test("süresi dolmuş sıfırlama bağlantısı çalışmaz", async () => {
  await register();
  const token = (await requestPasswordReset("ayse@ornek.com", "http://x"))!;
  await db.update(schema.passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1) });
  expect((await resetPassword(token, "Yeni-Guclu-Parola-7")).ok).toBe(false);
});

test("parola değişikliği mevcut parolayı ister", async () => {
  const userId = await register();
  expect((await changePassword(userId, "yanlis-parola-1", "Yeni-Guclu-Parola-7")).ok).toBe(false);
  expect((await changePassword(userId, PW, "Yeni-Guclu-Parola-7")).ok).toBe(true);
});

test("TOTP kodu bir kez kullanılabilir", async () => {
  const userId = await register();
  const secret = generateTotpSecret();
  await db.update(schema.users).set({ totpSecret: secret }).where(eq(schema.users.id, userId));
  const code = currentTotp(secret);
  expect(await verifyTotpForUser(userId, secret, code)).toBe(true);
  expect(await verifyTotpForUser(userId, secret, code)).toBe(false);
  expect(await verifyTotpForUser(userId, secret, "12345")).toBe(false);
});

test("TOTP anahtarı şifreli saklanır ve doğrulamada çözülür", async () => {
  const { sealSecret, openSecret } = await import("@/server/auth/crypto");
  const userId = await register();
  const secret = generateTotpSecret();
  const sealed = sealSecret(secret);
  expect(sealed).toMatch(/^v1:/);
  expect(sealed).not.toContain(secret);
  expect(openSecret(sealed)).toBe(secret);
  expect(sealSecret(secret)).not.toBe(sealed);
  await db.update(schema.users).set({ totpSecret: sealed }).where(eq(schema.users.id, userId));
  expect(await verifyTotpForUser(userId, sealed, currentTotp(secret))).toBe(true);
  expect(() => openSecret(`${sealed.slice(0, -2)}xx`)).toThrow();
});
