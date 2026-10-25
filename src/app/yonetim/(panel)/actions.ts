"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/lib/form";
import { getClientIp, getSession, signOut } from "@/server/auth/current";
import { audit } from "@/server/services/audit";
import { resolveRefund } from "@/server/services/admin/dashboard";
import { adminContext, errorState, parseForm } from "../_lib/action";

export async function adminSignOutAction(): Promise<void> {
  const session = await getSession();
  if (session) {
    await audit({ action: "admin.logout", actorId: session.user.id, ip: await getClientIp() }).catch(() => {});
  }
  await signOut();
  redirect("/yonetim/giris");
}

export async function resolveRefundAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ auditId: z.uuid() }), form);
  if (!parsed.ok) return { error: "Kayıt bulunamadı. Sayfayı yenileyin." };
  try {
    await resolveRefund(parsed.data.auditId, ctx);
  } catch (e) {
    return errorState(e);
  }
  revalidatePath("/yonetim");
  return { ok: true, message: "İade yapıldı olarak işaretlendi." };
}
