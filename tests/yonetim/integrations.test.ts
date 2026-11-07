import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "vitest";
import { db, schema } from "@/server/db";
import { AdminAccessError, AdminError, type AdminContext } from "@/server/services/admin/context";
import { clearIntegrationKeys, listIntegrations, saveIntegrationKeys, setIntegrationExpiry, type Testers } from "@/server/services/admin/integrations";
import { clearSecretCache, getSecret } from "@/server/secrets";
import { makeUser, resetDb } from "../helpers/db";

let ctx: AdminContext;
const tested: Record<string, string>[] = [];
const testers: Testers = {
  claude: async (v) => (tested.push(v), v.ANTHROPIC_API_KEY === "sk-dogru-1234" ? { ok: true, message: "Çalışıyor" } : { ok: false, message: "Anahtar geçersiz" }),
  n11: async () => ({ ok: true, message: "Çalışıyor" }),
};
beforeEach(async () => {
  await resetDb();
  process.env.SECRETS_KEY = randomBytes(32).toString("base64");
  clearSecretCache();
  tested.length = 0;
  ctx = { actorId: (await makeUser({ role: "admin" })).id };
});
afterEach(() => {
  delete process.env.SECRETS_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

test("doğru anahtar denenip kaydedilir; değer günlüğe ve listeye yazılmaz", async () => {
  await saveIntegrationKeys(ctx, "claude", { ANTHROPIC_API_KEY: "sk-dogru-1234" }, testers);
  expect(await getSecret("ANTHROPIC_API_KEY")).toBe("sk-dogru-1234");
  const list = await listIntegrations();
  const claude = list.find((i) => i.id === "claude")!;
  expect(claude).toMatchObject({ configured: true, ok: true, editable: true });
  expect(claude.secrets).toEqual([{ name: "ANTHROPIC_API_KEY", source: "panel", last4: "1234" }]);
  expect(JSON.stringify(list)).not.toContain("sk-dogru");
  const logs = await db.select().from(schema.auditLog);
  expect(JSON.stringify(logs)).not.toContain("sk-dogru");
  expect(logs.map((l) => l.action)).toContain("integration.secret_set");
});

test("deneme başarısızsa kaydedilmez, nedeni söylenir", async () => {
  await expect(saveIntegrationKeys(ctx, "claude", { ANTHROPIC_API_KEY: "sk-yanlis" }, testers)).rejects.toThrow(/Anahtar geçersiz/);
  expect(await db.select().from(schema.integrationSecrets)).toHaveLength(0);
});

test("N11 iki değer birlikte ister; düzenlenemeyen entegrasyon reddedilir", async () => {
  await expect(saveIntegrationKeys(ctx, "n11", { N11_API_KEY: "a" }, testers)).rejects.toBeInstanceOf(AdminError);
  await expect(saveIntegrationKeys(ctx, "iyzico", { X: "a" }, testers)).rejects.toBeInstanceOf(AdminError);
  await saveIntegrationKeys(ctx, "n11", { N11_API_KEY: "anahtar-1", N11_API_SECRET: "sir-2" }, testers);
  expect(await getSecret("N11_API_SECRET")).toBe("sir-2");
});

test("paneldeki anahtar kaldırılınca ortam değerine dönülür", async () => {
  process.env.ANTHROPIC_API_KEY = "env-5678";
  await saveIntegrationKeys(ctx, "claude", { ANTHROPIC_API_KEY: "sk-dogru-1234" }, testers);
  await clearIntegrationKeys(ctx, "claude");
  const claude = (await listIntegrations()).find((i) => i.id === "claude")!;
  expect(claude.secrets[0]).toMatchObject({ source: "env", last4: "5678" });
});

test("son kullanma tarihi ve kalan gün", async () => {
  await setIntegrationExpiry(ctx, "claude", "2026-11-14", new Date("2026-11-08T10:00:00+03:00"));
  const claude = (await listIntegrations(new Date("2026-11-08T10:00:00+03:00"))).find((i) => i.id === "claude")!;
  expect(claude).toMatchObject({ expiresAt: "2026-11-14", daysLeft: 6 });
  await expect(setIntegrationExpiry(ctx, "claude", "14.11.2026")).rejects.toBeInstanceOf(AdminError);
  await setIntegrationExpiry(ctx, "claude", null);
  expect((await listIntegrations()).find((i) => i.id === "claude")!.expiresAt).toBeNull();
});

test("yönetici olmayan reddedilir", async () => {
  const u = await makeUser();
  await expect(saveIntegrationKeys({ actorId: u.id }, "claude", { ANTHROPIC_API_KEY: "sk-dogru-1234" }, testers)).rejects.toBeInstanceOf(AdminAccessError);
});
