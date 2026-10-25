"use server";

import { logError } from "@/server/log";
import { redirect } from "next/navigation";
import { fieldErrorsOf, safeValues, type FormState } from "@/lib/form";
import { requireAccountUser } from "@/components/account/guard";
import { getSession } from "@/server/auth/current";
import { rateLimit } from "@/server/auth/rate-limit";
import { changePassword, updateProfile } from "@/server/services/accounts";
import { createAddress, deleteAddress, savedAddressSchema, updateAddress } from "@/server/services/addresses";
import { CHANGE_PASSWORD_LIMIT } from "@/components/account/login";
import {
  changePasswordSchema,
  formatPhone,
  idSchema,
  profileSchema,
  readFields,
  tooManyAttempts,
} from "@/components/account/schemas";
import { startSession } from "@/components/account/session";

const GENERIC_ERROR = "Şu anda işleminizi tamamlayamadık. Birkaç dakika sonra tekrar deneyin.";
const ADDRESS_KEYS = ["title", "fullName", "phone", "city", "district", "line"] as const;

export async function updateProfileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireAccountUser("/hesabim/profil");
  const raw = readFields(form, ["firstName", "lastName", "phone"]);
  const values = safeValues(raw);
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };

  try {
    await updateProfile(user.id, parsed.data);
  } catch (e) {
    logError("[profil]", e);
    return { error: GENERIC_ERROR, values };
  }
  const { firstName, lastName, phone } = parsed.data;
  return {
    ok: true,
    message: "Bilgileriniz kaydedildi.",
    values: { firstName: firstName.trim(), lastName: lastName.trim(), phone: formatPhone(phone) },
  };
}

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireAccountUser("/hesabim/profil");
  const raw = readFields(form, ["currentPassword", "newPassword", "newPasswordRepeat"]);
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  try {
    // Servis bütün oturumları silmeden önce: bu oturum iki adımı geçmiş miydi (yalnız yönetici)
    const hadSecondFactor = (await getSession())?.secondFactor === true;
    const limited = await rateLimit(
      `parola-degistir:${user.id}`,
      CHANGE_PASSWORD_LIMIT.limit,
      CHANGE_PASSWORD_LIMIT.windowSec,
    );
    if (!limited.ok) return { error: tooManyAttempts(limited.retryAfter) };

    const result = await changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
    if (!result.ok) {
      return result.field ? { fieldErrors: { [result.field]: result.error } } : { error: result.error };
    }
    // Servis kullanıcının bütün oturumlarını sildi; bu cihazda oturum açık kalsın
    await startSession({ id: user.id, role: user.role }, { keepSecondFactor: hadSecondFactor });
  } catch (e) {
    logError("[parola-degistir]", e);
    return { error: GENERIC_ERROR };
  }
  return { ok: true, message: "Parolanız değişti. Diğer cihazlardaki oturumlarınız kapatıldı." };
}

export async function createAddressAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireAccountUser("/hesabim/adresler/yeni");
  const raw = readFields(form, ADDRESS_KEYS);
  const values = safeValues(raw);
  const parsed = savedAddressSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };

  try {
    const created = await createAddress(user.id, parsed.data);
    if (!created.ok) return { error: created.error, values };
  } catch (e) {
    logError("[adres-ekle]", e);
    return { error: GENERIC_ERROR, values };
  }
  redirect("/hesabim/adresler?durum=eklendi");
}

export async function updateAddressAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireAccountUser("/hesabim/adresler");
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return { error: "Adres bulunamadı. Adres listesine dönüp yeniden deneyin." };
  const raw = readFields(form, ADDRESS_KEYS);
  const values = safeValues(raw);
  const parsed = savedAddressSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error), values };

  try {
    // Sahiplik serviste: başka kullanıcının adresi güncellenmez (false döner)
    const updated = await updateAddress(user.id, id.data, parsed.data);
    if (!updated) return { error: "Adres bulunamadı. Adres listesine dönüp yeniden deneyin.", values };
  } catch (e) {
    logError("[adres-guncelle]", e);
    return { error: GENERIC_ERROR, values };
  }
  redirect("/hesabim/adresler?durum=guncellendi");
}

export async function deleteAddressAction(form: FormData): Promise<void> {
  const user = await requireAccountUser("/hesabim/adresler");
  const id = idSchema.safeParse(form.get("id"));
  let deleted = false;
  if (id.success) {
    try {
      deleted = await deleteAddress(user.id, id.data);
    } catch (e) {
      logError("[adres-sil]", e);
    }
  }
  redirect(`/hesabim/adresler?durum=${deleted ? "silindi" : "silinemedi"}`);
}
