import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { attemptLogin, LOGIN_LIMITS } from "@/components/account/login";
import { isTokenFormat, LOGIN_FAILED, resetSchema } from "@/components/account/schemas";
import { db, schema } from "@/server/db";
import { registerCustomer, requestPasswordReset, resetPassword } from "@/server/services/accounts";
import { resetDb } from "../helpers/db";

beforeEach(resetDb);

const PW = "Kuvvetli-Parola-42";
const EMAIL = "ayse@ornek.com";

async function register() {
  const r = await registerCustomer({ email: EMAIL, password: PW, firstName: "Ayşe", lastName: "Yılmaz" });
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

test("doğru parolayla giriş; yanlış parola ve bilinmeyen e-posta aynı mesajı alır", async () => {
  const id = await register();
  const ok = await attemptLogin(EMAIL, PW, "10.0.0.1");
  expect(ok).toEqual({ ok: true, user: { id, role: "customer" } });

  const wrong = await attemptLogin(EMAIL, "yanlis-parola-1", "10.0.0.1");
  const unknown = await attemptLogin("yok@ornek.com", PW, "10.0.0.1");
  expect(wrong).toEqual({ ok: false, error: LOGIN_FAILED });
  expect(unknown).toEqual(wrong);
});

test("aynı e-postaya çok deneme: farklı IP'lerden gelse de sınırlanır, doğru parola da beklemek zorunda", async () => {
  await register();
  for (let i = 0; i < LOGIN_LIMITS.email.limit; i++) {
    const r = await attemptLogin(EMAIL, `yanlis-parola-${i}`, `10.0.1.${i}`);
    expect(r).toEqual({ ok: false, error: LOGIN_FAILED });
  }
  const blocked = await attemptLogin(EMAIL, PW, "10.0.2.1");
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) expect(blocked.error).toMatch(/^Çok fazla deneme\. (1[0-5]|[1-9]) dakika sonra tekrar deneyin\.$/);

  // Başka bir hesap etkilenmez
  await registerCustomer({ email: "mehmet@ornek.com", password: PW, firstName: "Mehmet", lastName: "Kaya" });
  expect((await attemptLogin("mehmet@ornek.com", PW, "10.0.2.1")).ok).toBe(true);
});

test("tek IP'den çok sayıda farklı e-postayla deneme sınırlanır", async () => {
  await register();
  const ip = "10.0.3.7";
  for (let i = 0; i < LOGIN_LIMITS.ip.limit; i++) {
    const r = await attemptLogin(`deneme${i}@ornek.com`, "yanlis-parola-1", ip);
    expect(r.ok).toBe(false);
  }
  const blocked = await attemptLogin(EMAIL, PW, ip);
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) expect(blocked.error).toMatch(/^Çok fazla deneme/);
  // Başka IP'den aynı hesap girebilir
  expect((await attemptLogin(EMAIL, PW, "10.0.3.8")).ok).toBe(true);
});

test("sıfırlama token'ı sayfanın beklediği biçimde; yeni parolayla giriş yapılır, eskisiyle yapılamaz", async () => {
  await register();
  const token = await requestPasswordReset(EMAIL, "http://localhost:3000");
  expect(isTokenFormat(token)).toBe(true);

  const NEW = "Yepyeni-Parola-77";
  const input = resetSchema.parse({ token, password: NEW, passwordRepeat: NEW });
  expect((await resetPassword(input.token, input.password)).ok).toBe(true);

  expect((await attemptLogin(EMAIL, NEW, "10.0.4.1")).ok).toBe(true);
  expect(await attemptLogin(EMAIL, PW, "10.0.4.1")).toEqual({ ok: false, error: LOGIN_FAILED });
  // Token ikinci kez kullanılamaz
  expect((await resetPassword(input.token, "Baska-Parola-99x")).ok).toBe(false);
});

test("bilinmeyen e-postaya sıfırlama isteği token üretmez", async () => {
  expect(await requestPasswordReset("yok@ornek.com", "http://localhost:3000")).toBeNull();
});

test("yönetici hesabı mağaza girişinden oturum açamaz; doğru parola da yanlış parolayla aynı yanıtı alır", async () => {
  const id = await register();
  await db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, id));

  const right = await attemptLogin(EMAIL, PW, "10.0.5.1");
  const wrong = await attemptLogin(EMAIL, "yanlis-parola-1", "10.0.5.1");
  expect(right).toEqual({ ok: false, error: LOGIN_FAILED });
  expect(wrong).toEqual(right);

  // Parolanın doğru girildiği yöneticinin göreceği işlem günlüğüne yazılır (yanlış parola yazılmaz)
  const logged = await db.query.auditLog.findMany({ where: eq(schema.auditLog.action, "admin.login.store_rejected") });
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatchObject({ actorId: id, target: EMAIL, ip: "10.0.5.1" });
});
