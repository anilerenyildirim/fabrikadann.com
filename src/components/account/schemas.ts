import { stripControl } from "@/lib/text";
import { z } from "zod";
import { safeReturnPath } from "@/lib/form";
import { PASSWORD_MAX } from "@/server/auth/password";
import { emailSchema, nameSchema } from "@/server/services/accounts";
import { normalizePhone } from "@/server/services/addresses";

/*
  Hesap ve kimlik doğrulama formlarının şemaları ile saf yardımcılar.
  Yalnızca sunucuda (Server Action) ve testlerde kullanılır; istemci bileşenleri içe aktarmaz.
*/

/** FormData'dan yalnızca beklenen alanları alır; eksik alan boş dize olur, dosya alanları yok sayılır. */
export function readFields<K extends string>(form: FormData, keys: readonly K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const v = form.get(key);
    out[key] = typeof v === "string" ? stripControl(v) : "";
  }
  return out;
}

/**
 * Giriş/kayıt sonrası dönüş adresi. safeReturnPath'e ek olarak kontrol karakteri ve ters bölü
 * içeren değerleri reddeder: tarayıcılar URL'deki sekme/satır sonunu silip "/\t/site.com"u
 * "//site.com"a çevirir (açık yönlendirme).
 */
export function returnPath(value: string | null | undefined, fallback = "/hesabim"): string {
  if (!value || /[\u0000-\u001F\u007F\\]/.test(value)) return fallback;
  return safeReturnPath(value, fallback);
}

/** randomToken() biçimi: 32 bayt, base64url, 43 karakter. */
export function isTokenFormat(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Hız sınırı aşıldığında gösterilecek mesaj; süre dakikaya yuvarlanır. */
export function tooManyAttempts(retryAfterSec: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `Çok fazla deneme. ${minutes} dakika sonra tekrar deneyin.`;
}

export const LOGIN_FAILED = "E-posta ya da parola hatalı.";

export const EMAIL_NOT_VERIFIED =
  "E-posta adresinizi henüz doğrulamadınız. Size yeni bir doğrulama bağlantısı gönderdik; e-postanızı kontrol edin.";

export const REGISTERED =
  "Neredeyse tamam. E-posta adresinize bir doğrulama bağlantısı gönderdik; hesabınızı etkinleştirmek için bağlantıyı açın. E-posta birkaç dakika içinde gelmezse gereksiz klasörünü kontrol edin.";

export const RESET_REQUESTED =
  "Bu e-postayla kayıtlı bir hesap varsa, parola sıfırlama bağlantısını gönderdik. Bağlantı 1 saat geçerli.";

const passwordInput = (required: string) =>
  z.string().min(1, required).max(PASSWORD_MAX, `Parola en fazla ${PASSWORD_MAX} karakter olabilir.`);

/** Yeni parola: kuralların ayrıntısı (yaygın parola vb.) servisteki passwordProblem'de. */
const newPassword = z
  .string()
  .min(10, "Parola en az 10 karakter olmalı.")
  .max(PASSWORD_MAX, `Parola en fazla ${PASSWORD_MAX} karakter olabilir.`);

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordInput("Parolanızı girin."),
  sonra: z.string().max(2000).optional(),
});

export const registerSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  password: newPassword,
  kvkk: z.literal("on", { error: "Devam etmek için KVKK aydınlatma metnini okuduğunuzu onaylayın." }),
  sonra: z.string().max(2000).optional(),
});

export const forgotSchema = z.object({ email: emailSchema });

export const resetSchema = z
  .object({
    token: z.string().refine(isTokenFormat, "Bağlantı geçersiz. Yeni bir bağlantı isteyin."),
    password: newPassword,
    passwordRepeat: z.string(),
  })
  .refine((v) => v.password === v.passwordRepeat, {
    path: ["passwordRepeat"],
    message: "Parolalar eşleşmiyor. İki alana da aynı parolayı yazın.",
  });

export const profileSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  phone: z
    .string()
    .trim()
    .max(20, "Geçerli bir telefon numarası girin (05xx xxx xx xx).")
    .transform((v, ctx) => {
      if (v === "") return null;
      const p = normalizePhone(v);
      if (!p) {
        ctx.addIssue({ code: "custom", message: "Geçerli bir telefon numarası girin (05xx xxx xx xx)." });
        return z.NEVER;
      }
      return p;
    }),
});

export const changePasswordSchema = z
  .object({
    currentPassword: passwordInput("Mevcut parolanızı girin."),
    newPassword,
    newPasswordRepeat: z.string(),
  })
  .refine((v) => v.newPassword === v.newPasswordRepeat, {
    path: ["newPasswordRepeat"],
    message: "Parolalar eşleşmiyor. İki alana da aynı parolayı yazın.",
  });

export const idSchema = z.string().uuid();

/** 05551112233 → 0555 111 22 33 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const m = /^(0\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}
