"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { formToObject, type FormState } from "@/lib/form";
import { getClientIp, getSession, readSessionToken, setSessionCookie, signOut } from "@/server/auth/current";
import { createSession, deleteSession, markSecondFactor } from "@/server/auth/session";
import { adminTotpStep } from "@/server/services/admin/auth";
import { GENERIC_ERROR } from "../_lib/action";

const codeSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Doğrulama uygulamanızdaki 6 haneli kodu yazın."));

export async function adminTotpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") redirect("/yonetim/giris");
  if (session.secondFactor) redirect("/yonetim");

  const parsed = codeSchema.safeParse(formToObject(form).code ?? "");
  if (!parsed.success) return { fieldErrors: { code: parsed.error.issues[0]!.message } };

  try {
    const token = await readSessionToken();
    if (!token) return { error: "Oturumunuz kapanmış. Yeniden giriş yapın." };
    const result = await adminTotpStep(session.user.id, parsed.data, await getClientIp());
    if (!result.ok) return { fieldErrors: { code: result.error } };
    // Yetki yükseldi: iki adımı geçmiş yeni bir oturum açılır, yalnızca parolayla açılan eski token geçersizleşir
    const fresh = await createSession(session.user.id, "admin");
    await markSecondFactor(fresh.token);
    await setSessionCookie(fresh.token, fresh.expiresAt);
    await deleteSession(token);
  } catch (e) {
    console.error("[yonetim-iki-adim]", e);
    return { error: GENERIC_ERROR };
  }
  redirect("/yonetim");
}

/** İkinci adımdan vazgeçip oturumu kapatır (başka hesapla girmek için). */
export async function abandonLoginAction(): Promise<void> {
  await signOut();
  redirect("/yonetim/giris");
}
