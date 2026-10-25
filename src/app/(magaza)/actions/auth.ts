"use server";

import { logError } from "@/server/log";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { env } from "@/env";
import { fieldErrorsOf, safeValues, type FormState } from "@/lib/form";
import { getClientIp, signOut } from "@/server/auth/current";
import { rateLimit } from "@/server/auth/rate-limit";
import {
  registerCustomer,
  requestPasswordReset,
  resetPassword,
  sendRegistrationEmail,
  verifyEmail,
} from "@/server/services/accounts";
import { attemptLogin, FORGOT_LIMITS, REGISTER_LIMIT, RESET_LIMIT } from "@/components/account/login";
import {
  forgotSchema,
  loginSchema,
  readFields,
  REGISTERED,
  registerSchema,
  RESET_REQUESTED,
  resetSchema,
  returnPath,
  tooManyAttempts,
} from "@/components/account/schemas";
import { startSession } from "@/components/account/session";

const GENERIC_ERROR = "Şu anda işleminizi tamamlayamadık. Birkaç dakika sonra tekrar deneyin.";

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = readFields(form, ["email", "password", "sonra"]);
  const values = safeValues(raw);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };

  try {
    const result = await attemptLogin(parsed.data.email, parsed.data.password, await getClientIp());
    if (!result.ok) return { error: result.error, values };
    await startSession(result.user);
  } catch (e) {
    logError("[giris]", e);
    return { error: GENERIC_ERROR, values };
  }
  redirect(returnPath(parsed.data.sonra));
}

export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = readFields(form, ["firstName", "lastName", "email", "password", "kvkk", "sonra"]);
  const values = safeValues(raw);
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };

  try {
    const limited = await rateLimit(`kayit:${await getClientIp()}`, REGISTER_LIMIT.limit, REGISTER_LIMIT.windowSec);
    if (!limited.ok) return { error: tooManyAttempts(limited.retryAfter), values };

    const { firstName, lastName, email, password } = parsed.data;
    const created = await registerCustomer({ firstName, lastName, email, password });
    if (!created.ok) {
      return created.field
        ? { fieldErrors: { [created.field]: created.error }, values }
        : { error: created.error, values };
    }
    // Yeni hesap da var olan hesap da aynı yanıtı alır; e-posta yanıttan sonra gönderilir (süre farkı olmasın)
    const outcome = created.value;
    after(() =>
      sendRegistrationEmail(outcome, env.APP_URL).catch((e) => logError("[kayit] e-posta gönderilemedi", e)),
    );
  } catch (e) {
    logError("[kayit]", e);
    return { error: GENERIC_ERROR, values };
  }
  return { ok: true, message: REGISTERED };
}

const VERIFY_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** E-postadaki bağlantıyla açılan sayfanın "Hesabımı etkinleştir" butonu. */
export async function verifyEmailAction(_prev: FormState, form: FormData): Promise<FormState> {
  const token = readFields(form, ["token"]).token;
  if (!VERIFY_TOKEN_RE.test(token)) return { error: "Bağlantı geçersiz. E-postadaki bağlantıyı yeniden açın." };
  try {
    const limited = await rateLimit(`dogrula:${await getClientIp()}`, 20, 900);
    if (!limited.ok) return { error: tooManyAttempts(limited.retryAfter) };
    const user = await verifyEmail(token);
    if (!user) {
      return {
        error:
          "Bağlantı geçersiz, kullanılmış ya da süresi dolmuş. Giriş yapmayı deneyin; hesabınız doğrulanmamışsa yeni bağlantı gönderilir.",
      };
    }
    await startSession(user);
  } catch (e) {
    logError("[dogrula]", e);
    return { error: GENERIC_ERROR };
  }
  redirect("/hesabim?dogrulandi=1");
}

export async function forgotPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = readFields(form, ["email"]);
  const values = safeValues(raw);
  const parsed = forgotSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };
  const { email } = parsed.data;

  try {
    const byIp = await rateLimit(
      `sifre-sifirlama:ip:${await getClientIp()}`,
      FORGOT_LIMITS.ip.limit,
      FORGOT_LIMITS.ip.windowSec,
    );
    if (!byIp.ok) return { error: tooManyAttempts(byIp.retryAfter), values };
    const byEmail = await rateLimit(`sifre-sifirlama:eposta:${email}`, FORGOT_LIMITS.email.limit, FORGOT_LIMITS.email.windowSec);
    // Aynı adrese art arda e-posta gönderilmesin; yanıt yine aynı (hesabın varlığı belli olmasın)
    if (byEmail.ok) {
      // Yanıttan sonra çalışır: hesap var/yok durumunda yanıt süresi farklılaşmaz
      after(async () => {
        try {
          await requestPasswordReset(email, env.APP_URL);
        } catch (e) {
          logError("[sifre-sifirlama]", e);
        }
      });
    }
  } catch (e) {
    logError("[sifre-sifirlama]", e);
    return { error: GENERIC_ERROR, values };
  }
  // E-posta alanı dolu kalsın: "Bağlantıyı yeniden gönder" yeniden yazmadan çalışsın
  return { ok: true, message: RESET_REQUESTED, values };
}

export async function resetPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = readFields(form, ["token", "password", "passwordRepeat"]);
  const parsed = resetSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = fieldErrorsOf(parsed.error);
    return fieldErrors.token ? { error: fieldErrors.token } : { fieldErrors };
  }

  try {
    const limited = await rateLimit(`sifre-yenile:ip:${await getClientIp()}`, RESET_LIMIT.limit, RESET_LIMIT.windowSec);
    if (!limited.ok) return { error: tooManyAttempts(limited.retryAfter) };

    const result = await resetPassword(parsed.data.token, parsed.data.password);
    if (!result.ok) {
      return result.field === "password" ? { fieldErrors: { password: result.error } } : { error: result.error };
    }
  } catch (e) {
    logError("[sifre-yenile]", e);
    return { error: GENERIC_ERROR };
  }
  redirect("/giris?sifirlandi=1");
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect("/");
}
