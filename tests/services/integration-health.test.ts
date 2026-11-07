import { beforeEach, expect, test } from "vitest";
import { db, schema } from "@/server/db";
import { checkIntegrations, checkIntegrationsIfDue } from "@/server/integrations/health";
import { clearSecretCache } from "@/server/secrets";
import { setIntegrationExpiry, type Testers } from "@/server/services/admin/integrations";
import { makeUser, resetDb } from "../helpers/db";

let calls = 0;
let claudeOk = true;
const testers: Testers = {
  claude: async () => (calls++, claudeOk ? { ok: true, message: "Çalışıyor" } : { ok: false, message: "Anahtar geçersiz ya da süresi dolmuş" }),
};
beforeEach(async () => {
  await resetDb();
  clearSecretCache();
  calls = 0;
  claudeOk = true;
  process.env.ANTHROPIC_API_KEY = "env-anahtar";
});
const notes = () => db.select().from(schema.notifications);
const at = (s: string) => new Date(`${s}T09:00:00+03:00`);

test("son kullanmaya 7, 3, 1 gün kala ve geçince birer kez bildirim", async () => {
  const admin = await makeUser({ role: "admin" });
  await setIntegrationExpiry({ actorId: admin.id }, "claude", "2026-11-14");
  for (const day of ["2026-11-06", "2026-11-07", "2026-11-07", "2026-11-10", "2026-11-11", "2026-11-13", "2026-11-14", "2026-11-15"]) {
    await checkIntegrations({ now: at(day), testers });
  }
  const titles = (await notes()).map((n) => n.title);
  expect(titles).toEqual([
    "Claude (AI Asistan) anahtarının süresi 7 gün sonra doluyor",
    "Claude (AI Asistan) anahtarının süresi 3 gün sonra doluyor",
    "Claude (AI Asistan) anahtarının süresi yarın doluyor",
    "Claude (AI Asistan) anahtarının süresi doldu",
  ]);
  expect((await notes())[0]).toMatchObject({ kind: "integration", source: "system", url: "/yonetim/ayarlar/api-anahtarlari" });
});

test("çalışmayan bağlantı günde bir kez bildirilir; durum kaydedilir", async () => {
  claudeOk = false;
  await checkIntegrations({ now: at("2026-11-08"), testers });
  await checkIntegrations({ now: new Date(at("2026-11-08").getTime() + 3600_000), testers });
  await checkIntegrations({ now: at("2026-11-09"), testers });
  const fails = (await notes()).filter((n) => n.title.includes("çalışmıyor"));
  expect(fails).toHaveLength(2);
  expect(fails[0]!.body).toBe("Anahtar geçersiz ya da süresi dolmuş");
  const [row] = await db.select().from(schema.integrations);
  expect(row).toMatchObject({ id: "claude", ok: false });
});

test("tanımlı olmayan bağlantı denenmez; kontrol saatte bir çalışır", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await checkIntegrations({ now: at("2026-11-08"), testers });
  expect(calls).toBe(0);
  process.env.ANTHROPIC_API_KEY = "env-anahtar";
  expect(await checkIntegrationsIfDue({ now: at("2026-11-08"), testers })).toBe(false);
  expect(await checkIntegrationsIfDue({ now: new Date(at("2026-11-08").getTime() + 61 * 60_000), testers })).toBe(true);
  expect(calls).toBe(1);
});

test("bir bağlantının denemesi hata fırlatsa da diğerleri ve son kullanma kontrolü sürer", async () => {
  const admin = await makeUser({ role: "admin" });
  await setIntegrationExpiry({ actorId: admin.id }, "claude", "2026-11-09");
  const broken: Testers = { ...testers, claude: async () => { throw new Error("beklenmeyen"); } };
  await checkIntegrations({ now: at("2026-11-08"), testers: broken });
  expect((await notes()).map((n) => n.title)).toContain("Claude (AI Asistan) anahtarının süresi yarın doluyor");
});

test("tek seferlik ulaşılamama bildirim göndermez; art arda ikincisi gönderir", async () => {
  claudeOk = false;
  const unreachableTesters: Testers = { claude: async () => ({ ok: false, message: "Sağlayıcıya ulaşılamadı", transient: true }) };
  await checkIntegrations({ now: at("2026-11-08"), testers: unreachableTesters });
  expect(await notes()).toHaveLength(0);
  await checkIntegrations({ now: new Date(at("2026-11-08").getTime() + 3600_000), testers: unreachableTesters });
  expect(await notes()).toHaveLength(1);
});

test("panelde çözülemeyen anahtar bildirilir", async () => {
  const { randomBytes } = await import("node:crypto");
  const { storeSecret } = await import("@/server/secrets");
  process.env.SECRETS_KEY = randomBytes(32).toString("base64");
  delete process.env.ANTHROPIC_API_KEY;
  await storeSecret("ANTHROPIC_API_KEY", "panel-anahtar", null);
  process.env.SECRETS_KEY = randomBytes(32).toString("base64");
  clearSecretCache();
  await checkIntegrations({ now: at("2026-11-08"), testers });
  const n = (await notes()).find((x) => x.title.includes("okunamıyor"));
  expect(n?.title).toBe("Claude (AI Asistan) anahtarı okunamıyor");
  delete process.env.SECRETS_KEY;
});
