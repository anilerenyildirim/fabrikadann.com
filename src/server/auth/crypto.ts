import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/** 256 bit rastgele, URL'de güvenli token. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---- Veritabanında saklanan sırlar (TOTP anahtarı) için şifreleme ----

function secretKey(): Buffer {
  const base = process.env.SESSION_SECRET;
  if (!base || base.length < 32) throw new Error("SESSION_SECRET en az 32 karakter olmalı");
  return Buffer.from(hkdfSync("sha256", base, "fabrikadann", "totp-secret-v1", 32));
}

/** AES-256-GCM ile şifreler: "v1:" + base64url(iv | etiket | şifreli metin). */
export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url")}`;
}

/** sealSecret çıktısını çözer; önek yoksa eski (düz) kayıt olarak olduğu gibi döner. */
export function openSecret(stored: string): string {
  if (!stored.startsWith("v1:")) return stored;
  const raw = Buffer.from(stored.slice(3), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
