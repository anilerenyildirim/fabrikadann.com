"use server";

import { logError } from "@/server/log";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrorsOf, formToObject, safeValues, type FormState } from "@/lib/form";
import { getClientIp, readSessionToken, setSessionCookie } from "@/server/auth/current";
import { PASSWORD_MAX } from "@/server/auth/password";
import { createSession, deleteSession } from "@/server/auth/session";
import { adminPasswordStep } from "@/server/services/admin/auth";
import { GENERIC_ERROR } from "../_lib/action";

const loginSchema = z.object({
  email: z.string().trim().min(1, "E-posta adresinizi yazın.").max(254).email("Geçerli bir e-posta adresi yazın."),
  password: z.string().min(1, "Parolanızı yazın.").max(PASSWORD_MAX, "E-posta ya da parola hatalı."),
});

export async function adminLoginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = formToObject(form);
  const values = safeValues({ email: raw.email ?? "" });
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };

  try {
    const result = await adminPasswordStep(parsed.data.email, parsed.data.password, await getClientIp());
    if (!result.ok) return { error: result.error, values };
    // Yeni oturum (session fixation yok); ikinci adım doğrulanana kadar panel açılmaz
    const previous = await readSessionToken();
    if (previous) await deleteSession(previous);
    const { token, expiresAt } = await createSession(result.userId, "admin");
    await setSessionCookie(token, expiresAt);
  } catch (e) {
    logError("[yonetim-giris]", e);
    return { error: GENERIC_ERROR, values };
  }
  redirect("/yonetim/iki-adim");
}
