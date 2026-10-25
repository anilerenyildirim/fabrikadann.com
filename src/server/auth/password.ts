import { hash, verify } from "@node-rs/argon2";
import { COMMON_PASSWORDS } from "./common-passwords";

// OWASP önerisi: argon2id, 19 MiB bellek, 2 tur
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Kullanıcı bulunamadığında da aynı süreyi harcamak için (hesap numaralandırmayı önler). */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("fabrikadann-sahte-parola");
  await verifyPassword(await dummyHash, password);
}

/**
 * Uzun ama tahmin edilebilir parolalar: yaygın bir kelime + rakam/sembol ("Galatasaray1905!", "Parola2024"),
 * klavye dizileri, tekrar eden desenler, yalnızca rakam (telefon, doğum tarihi).
 */
function isPredictable(lower: string): boolean {
  if (/^\d+$/.test(lower)) return true;
  if (new Set(lower).size < 5) return true;
  if (/^(.{1,5}?)\1+$/.test(lower)) return true;
  // Baştaki/sondaki rakam ve sembolleri at, kalan kök yaygın bir kelime mi?
  // \W Türkçe harfleri (ı, ş …) de "harf değil" sayar; Unicode sınıfları kullanılır
  const core = lower.replace(/^[\p{N}\p{P}\p{S}\s]+|[\p{N}\p{P}\p{S}\s]+$/gu, "");
  if (core.length < 4) return true;
  return COMMON_BASES.some((base) => core === base || (core.startsWith(base) && core.length - base.length <= 2));
}

const COMMON_BASES = [
  "password", "passw0rd", "parola", "sifre", "şifre", "qwerty", "qwertyuiop", "asdfgh", "asdfghjkl", "zxcvbn",
  "zxcvbnm", "qazwsx", "iloveyou", "seniseviyorum", "admin", "yonetici", "yönetici", "welcome", "hosgeldin",
  "letmein", "monkey", "dragon", "football", "superman", "batman", "galatasaray", "fenerbahce", "fenerbahçe",
  "besiktas", "beşiktaş", "trabzonspor", "bursaspor", "istanbul", "ankara", "izmir", "turkiye", "türkiye",
  "ataturk", "atatürk", "fabrikadann", "fabrikadan", "ayakkabi", "ayakkabı", "sneaker", "kullanici", "abcdef",
  "abcdefgh", "abcdefghij", "deneme", "test", "merhaba", "allah", "mehmet", "ahmet", "mustafa", "ayse", "ayşe",
  "fatma", "emine", "zeynep", "elif",
];

/** Parola kurallarına uymuyorsa kullanıcıya gösterilecek hata, uyuyorsa null. */
export function passwordProblem(password: string, context: { email?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `Parola en az ${PASSWORD_MIN} karakter olmalı.`;
  if (password.length > PASSWORD_MAX) return `Parola en fazla ${PASSWORD_MAX} karakter olabilir.`;
  const lower = password.toLocaleLowerCase("tr-TR");
  if (COMMON_PASSWORDS.has(lower) || isPredictable(lower)) {
    return "Bu parola çok yaygın ya da tahmin edilebilir, başka bir parola seçin.";
  }
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Parola e-posta adresinizi içermemeli.";
  return null;
}
