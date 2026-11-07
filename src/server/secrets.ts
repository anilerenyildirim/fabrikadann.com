import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { logError } from "@/server/log";

/**
 * Panelden girilen entegrasyon anahtarları. Veritabanında AES-256-GCM ile şifreli durur; ana anahtar SECRETS_KEY
 * (base64, 32 bayt) yalnızca sunucu ortamında. Okurken öncelik: panel kaydı > ortam değişkeni.
 */

export const SECRET_NAMES = ["ANTHROPIC_API_KEY", "N11_API_KEY", "N11_API_SECRET"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export class SecretsError extends Error {}

const CACHE_MS = 60_000;
let cache: { at: number; values: Map<string, string>; unreadable: string[] } | null = null;

export function clearSecretCache() {
  cache = null;
}

function masterKey(): Buffer {
  const raw = process.env.SECRETS_KEY?.trim();
  const key = raw ? Buffer.from(raw, "base64") : null;
  if (!key || key.length !== 32) throw new SecretsError("Panelden anahtar kaydı kapalı: sunucuda 32 baytlık SECRETS_KEY tanımlayın.");
  return key;
}

export function secretsEnabled(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/** "v2.<iv>.<etiket>.<şifreli>" (base64url); kaydın adı ek doğrulama verisi: başka ada taşınan kayıt çözülmez. */
export function encryptSecret(name: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(name, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v2", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(name: string, text: string): string {
  const [v, iv, tag, data] = text.split(".");
  if (v !== "v2" || !iv || !tag || !data) throw new SecretsError("Şifreli anahtar biçimi tanınmadı");
  const tagBuf = Buffer.from(tag, "base64url");
  if (tagBuf.length !== 16) throw new SecretsError("Şifreli anahtar bozuk");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(name, "utf8"));
  decipher.setAuthTag(tagBuf);
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

async function loadPanel() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const values = new Map<string, string>();
  const unreadable: string[] = [];
  const rows = await db.select().from(schema.integrationSecrets);
  for (const r of rows) {
    try {
      values.set(r.name, decryptSecret(r.name, r.ciphertext));
    } catch (e) {
      unreadable.push(r.name);
      // Ana anahtar değiştiyse ya da kayıt bozuksa ortam değerine düşülür (değer günlüğe yazılmaz)
      logError(`[anahtar] ${r.name} çözülemedi`, e instanceof Error ? e.message : "hata");
    }
  }
  cache = { at: Date.now(), values, unreadable };
  return cache;
}

async function panelValues(): Promise<Map<string, string>> {
  return (await loadPanel()).values;
}

/** Panelde kayıtlı ama çözülemeyen anahtarlar (SECRETS_KEY değişmiş ya da kayıt bozuk). */
export async function unreadableSecrets(): Promise<string[]> {
  return (await loadPanel()).unreadable;
}

/** Anahtar değeri: panel kaydı, yoksa ortam değişkeni, yoksa null. */
export async function getSecret(name: SecretName): Promise<string | null> {
  const panel = (await panelValues()).get(name);
  if (panel) return panel;
  return process.env[name]?.trim() || null;
}

/** Kaynak ve son 4 karakter (değerin kendisi asla). */
export async function secretSource(name: SecretName): Promise<{ source: "panel" | "env" | null; last4: string | null; unreadable: boolean }> {
  const [row] = await db.select({ last4: schema.integrationSecrets.last4 }).from(schema.integrationSecrets).where(eq(schema.integrationSecrets.name, name));
  const unreadable = !!row && (await unreadableSecrets()).includes(name);
  if (row && (await panelValues()).has(name)) return { source: "panel", last4: row.last4, unreadable: false };
  const env = process.env[name]?.trim();
  return env ? { source: "env", last4: env.slice(-4), unreadable } : { source: null, last4: null, unreadable };
}

/** Birlikte kullanılan anahtarlar (ör. N11 anahtar + şifre) tek işlemde yazılır: biri kaydedilip diğeri kalmasın. */
export async function storeSecrets(entries: Partial<Record<SecretName, string>>, userId: string | null): Promise<void> {
  const rows = Object.entries(entries).map(([name, value]) => ({ name, ciphertext: encryptSecret(name, value!), last4: value!.slice(-4), updatedBy: userId }));
  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx
        .insert(schema.integrationSecrets)
        .values(r)
        .onConflictDoUpdate({ target: schema.integrationSecrets.name, set: { ciphertext: r.ciphertext, last4: r.last4, updatedBy: r.updatedBy } });
    }
  });
  clearSecretCache();
}

export async function storeSecret(name: SecretName, value: string, userId: string | null): Promise<void> {
  await storeSecrets({ [name]: value }, userId);
}

export async function deleteSecret(name: SecretName): Promise<void> {
  await db.delete(schema.integrationSecrets).where(eq(schema.integrationSecrets.name, name));
  clearSecretCache();
}
