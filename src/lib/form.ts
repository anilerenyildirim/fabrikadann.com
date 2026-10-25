import type { z } from "zod";

/** Server Action'ların useActionState ile döndürdüğü ortak durum. */
export type FormState = {
  ok?: boolean;
  /** Formun üstünde gösterilecek genel mesaj */
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Hata sonrası formu yeniden doldurmak için (parola alanları asla geri gönderilmez) */
  values?: Record<string, string>;
};

/** FormData'yı düz nesneye çevirir; dosya alanları atlanır. */
export function formToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** zod hatasını alan → ilk mesaj eşlemesine çevirir. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}

const SENSITIVE = /password|parola|sifre|totp|code|token/i;

/** Formu hata ile geri döndürürken hassas alanları çıkarır. */
export function safeValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([k]) => !SENSITIVE.test(k) && !k.startsWith("$")));
}

/**
 * Giriş sonrası dönüş adresi: yalnızca site içi göreli yol kabul edilir (açık yönlendirme yok).
 */
export function safeReturnPath(value: string | null | undefined, fallback = "/hesabim"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.length > 300) {
    return fallback;
  }
  return value;
}
