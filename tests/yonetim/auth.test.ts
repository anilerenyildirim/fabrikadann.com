import { beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { currentTotp, generateTotpSecret } from "@/server/auth/totp";
import {
  ADMIN_LOGIN_ERROR,
  ADMIN_NO_TOTP_ERROR,
  adminPasswordStep,
  adminTotpStep,
  TOTP_DAILY_LIMIT,
  TOTP_ERROR,
} from "@/server/services/admin/auth";
import { clearRateLimit } from "@/server/auth/rate-limit";
import { listAuditEntries } from "@/server/services/admin/audit-log";
import { saveSettings } from "@/server/services/admin/settings";
import { defaultSettings, getSettings } from "@/server/services/settings";
import { AdminAccessError } from "@/server/services/admin/context";
import { makeUser, resetDb } from "../helpers/db";

beforeEach(resetDb);

const PW = "Yonetim-Parolasi-2026";

async function userWith(role: "admin" | "customer", email: string, totp: string | null = null) {
  const u = await makeUser({ role, email });
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(PW), totpSecret: totp })
    .where(eq(schema.users.id, u.id));
  return u;
}

describe("yönetim girişi", () => {
  test("müşteri, yanlış parola ve bilinmeyen e-posta aynı mesajı alır", async () => {
    await userWith("customer", "musteri@ornek.com");
    await userWith("admin", "yonetici@ornek.com", generateTotpSecret());
    const results = await Promise.all([
      adminPasswordStep("musteri@ornek.com", PW, "1.1.1.1"),
      adminPasswordStep("yonetici@ornek.com", "yanlis-parola-1", "1.1.1.2"),
      adminPasswordStep("yok@ornek.com", PW, "1.1.1.3"),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, error: ADMIN_LOGIN_ERROR });
    const ok = await adminPasswordStep("YONETICI@ornek.com", PW, "1.1.1.4");
    expect(ok.ok).toBe(true);
    const actions = (await db.select().from(schema.auditLog)).map((a) => a.action).sort();
    expect(actions).toEqual(["admin.login.failed", "admin.login.failed", "admin.login.failed", "admin.login.password"]);
  });

  test("iki adımlı doğrulaması kurulmamış yönetici giremez", async () => {
    await userWith("admin", "yeni@ornek.com", null);
    expect(await adminPasswordStep("yeni@ornek.com", PW, "1.1.1.1")).toEqual({ ok: false, error: ADMIN_NO_TOTP_ERROR });
  });

  test("aynı e-postaya 5 denemeden sonra, aynı IP'den 10 denemeden sonra durdurulur", async () => {
    await userWith("admin", "yonetici@ornek.com", generateTotpSecret());
    for (let i = 0; i < 5; i++) await adminPasswordStep("yonetici@ornek.com", "yanlis-parola-1", `2.2.2.${i}`);
    const blocked = await adminPasswordStep("yonetici@ornek.com", PW, "2.2.2.9");
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.error).toMatch(/Çok fazla deneme/);

    for (let i = 0; i < 10; i++) await adminPasswordStep(`kisi${i}@ornek.com`, "x", "3.3.3.3");
    const byIp = await adminPasswordStep("baska@ornek.com", PW, "3.3.3.3");
    expect(!byIp.ok && byIp.error).toMatch(/Çok fazla deneme/);
  });

  test("TOTP: doğru kod geçer, aynı kod ikinci kez geçmez, yanlış kod ve müşteri reddedilir", async () => {
    const secret = generateTotpSecret();
    const admin = await userWith("admin", "yonetici@ornek.com", secret);
    const customer = await userWith("customer", "musteri@ornek.com", secret);
    expect(await adminTotpStep(admin.id, "000000", "1.1.1.1")).toEqual({ ok: false, error: TOTP_ERROR });
    const code = currentTotp(secret);
    expect(await adminTotpStep(admin.id, `${code.slice(0, 3)} ${code.slice(3)}`, "1.1.1.1")).toEqual({
      ok: true,
      userId: admin.id,
    });
    expect((await adminTotpStep(admin.id, code, "1.1.1.1")).ok).toBe(false);
    expect((await adminTotpStep(customer.id, currentTotp(secret), "1.1.1.1")).ok).toBe(false);
  });

  test("TOTP 5 denemeden sonra durdurulur", async () => {
    const secret = generateTotpSecret();
    const admin = await userWith("admin", "yonetici@ornek.com", secret);
    for (let i = 0; i < 5; i++) await adminTotpStep(admin.id, "000000", "1.1.1.1");
    const r = await adminTotpStep(admin.id, currentTotp(secret), "1.1.1.1");
    expect(!r.ok && r.error).toMatch(/Çok fazla deneme/);
  });

  test("TOTP günlük sınırı: 5 dakikalık pencere sıfırlansa da gün içinde 30 denemeden sonra durdurulur", async () => {
    const secret = generateTotpSecret();
    const admin = await userWith("admin", "yonetici@ornek.com", secret);
    for (let i = 0; i < TOTP_DAILY_LIMIT; i++) {
      // Kısa pencereyi her seferinde sıfırla: yalnızca günlük sayaç birikir
      await clearRateLimit(`totp:${admin.id}`);
      expect(await adminTotpStep(admin.id, "000000", "1.1.1.1")).toEqual({ ok: false, error: TOTP_ERROR });
    }
    await clearRateLimit(`totp:${admin.id}`);
    const r = await adminTotpStep(admin.id, currentTotp(secret), "1.1.1.1");
    expect(!r.ok && r.error).toMatch(/Çok fazla deneme yapıldı\. \d+ saat sonra/);
  });
});

describe("işlem günlüğü", () => {
  test("tanımsız grup adı (nesne özelliği dahil) süzgeç sayılmaz, hata vermez", async () => {
    await userWith("admin", "yonetici@ornek.com");
    await adminPasswordStep("yonetici@ornek.com", "yanlis-parola-1", "1.1.1.1");
    for (const group of ["constructor", "__proto__", "toString", "yok"]) {
      expect((await listAuditEntries({ group })).total).toBe(1);
    }
    expect((await listAuditEntries({ group: "admin" })).items.map((e) => e.action)).toEqual(["admin.login.failed"]);
    expect((await listAuditEntries({ group: "order" })).total).toBe(0);
  });
});

describe("ayarlar", () => {
  test("yalnızca https adresleri kabul edilir, değişiklik günlüğe yazılır", async () => {
    const admin = await userWith("admin", "yonetici@ornek.com");
    const ctx = { actorId: admin.id, ip: "1.1.1.1" };
    for (const bad of ["javascript:alert(1)", "http://instagram.com/x", "https://user:pw@evil.com", "instagram.com/x"]) {
      await expect(saveSettings({ ...defaultSettings, instagramUrl: bad }, ctx)).rejects.toMatchObject({
        field: "instagramUrl",
      });
    }
    await expect(saveSettings({ ...defaultSettings, email: "değil" }, ctx)).rejects.toMatchObject({ field: "email" });
    await saveSettings({ ...defaultSettings, shippingFee: 0, trendyolUrl: "https://www.trendyol.com/magaza/x" }, ctx);
    expect(await getSettings()).toMatchObject({ shippingFee: 0, trendyolUrl: "https://www.trendyol.com/magaza/x" });
    const [log] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "settings.update"));
    expect(log!.data).toMatchObject({ changed: ["shippingFee", "trendyolUrl"] });

    const customer = await makeUser();
    await expect(saveSettings(defaultSettings, { actorId: customer.id })).rejects.toBeInstanceOf(AdminAccessError);
  });
});
