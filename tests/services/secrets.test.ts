import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "vitest";
import { db, schema } from "@/server/db";
import { clearSecretCache, decryptSecret, encryptSecret, getSecret, storeSecret, deleteSecret } from "@/server/secrets";
import { resetDb } from "../helpers/db";

const KEY = randomBytes(32).toString("base64");
beforeEach(async () => {
  await resetDb();
  process.env.SECRETS_KEY = KEY;
  clearSecretCache();
});
afterEach(() => {
  delete process.env.SECRETS_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

test("şifreleme: aynı değer döner, her seferinde farklı metin, bozuk metin hata", () => {
  const a = encryptSecret("sk-ant-gizli-1234");
  const b = encryptSecret("sk-ant-gizli-1234");
  expect(a).not.toBe(b);
  expect(a).not.toContain("gizli");
  expect(decryptSecret(a)).toBe("sk-ant-gizli-1234");
  expect(() => decryptSecret(a.slice(0, -4) + "AAAA")).toThrow();
});

test("SECRETS_KEY yoksa ya da hatalıysa kayıt reddedilir", async () => {
  delete process.env.SECRETS_KEY;
  await expect(storeSecret("ANTHROPIC_API_KEY", "x-1234", null)).rejects.toThrow(/SECRETS_KEY/);
  process.env.SECRETS_KEY = "kisa";
  await expect(storeSecret("ANTHROPIC_API_KEY", "x-1234", null)).rejects.toThrow(/SECRETS_KEY/);
});

test("öncelik: panel > ortam; silince ortama döner; düz metin saklanmaz", async () => {
  process.env.ANTHROPIC_API_KEY = "env-anahtar";
  expect(await getSecret("ANTHROPIC_API_KEY")).toBe("env-anahtar");
  await storeSecret("ANTHROPIC_API_KEY", "panel-anahtar-9876", null);
  expect(await getSecret("ANTHROPIC_API_KEY")).toBe("panel-anahtar-9876");
  const [row] = await db.select().from(schema.integrationSecrets);
  expect(row!.ciphertext).not.toContain("panel-anahtar");
  expect(row!.last4).toBe("9876");
  await deleteSecret("ANTHROPIC_API_KEY");
  expect(await getSecret("ANTHROPIC_API_KEY")).toBe("env-anahtar");
});

test("ana anahtar değişip kayıt çözülemezse ortam değerine düşer, çökmez", async () => {
  process.env.ANTHROPIC_API_KEY = "env-anahtar";
  await storeSecret("ANTHROPIC_API_KEY", "panel-anahtar", null);
  process.env.SECRETS_KEY = randomBytes(32).toString("base64");
  clearSecretCache();
  expect(await getSecret("ANTHROPIC_API_KEY")).toBe("env-anahtar");
});
