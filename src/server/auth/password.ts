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

/** Parola kurallarına uymuyorsa kullanıcıya gösterilecek hata, uyuyorsa null. */
export function passwordProblem(password: string, context: { email?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `Parola en az ${PASSWORD_MIN} karakter olmalı.`;
  if (password.length > PASSWORD_MAX) return `Parola en fazla ${PASSWORD_MAX} karakter olabilir.`;
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(password)) {
    return "Bu parola çok yaygın, başka bir parola seçin.";
  }
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Parola e-posta adresinizi içermemeli.";
  return null;
}
