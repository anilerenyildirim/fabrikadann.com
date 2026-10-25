"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/(magaza)/actions/account";
import { Button } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { StateNotice, useFocusFirstError } from "./form-helpers";
import { PasswordField } from "./PasswordField";

export function ChangePasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changePasswordAction, {});
  const ref = useFocusFirstError(state);
  const errors = state.fieldErrors ?? {};

  return (
    <form ref={ref} action={action} noValidate className="flex flex-col gap-6">
      <StateNotice state={state} />
      {/* Parola yöneticileri hangi hesabın parolası olduğunu bilsin; gönderilmez */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <PasswordField
        label="Mevcut parola"
        name="currentPassword"
        autoComplete="current-password"
        maxLength={128}
        error={errors.currentPassword}
        required
      />
      <PasswordField
        label="Yeni parola"
        name="newPassword"
        autoComplete="new-password"
        maxLength={128}
        hint="En az 10 karakter."
        error={errors.newPassword}
        required
      />
      <PasswordField
        label="Yeni parola (tekrar)"
        name="newPasswordRepeat"
        autoComplete="new-password"
        maxLength={128}
        error={errors.newPasswordRepeat}
        required
      />
      <div>
        <Button type="submit" disabled={pending} aria-disabled={pending} className="w-full sm:w-auto">
          {pending ? "Kaydediliyor…" : "Parolayı değiştir"}
        </Button>
      </div>
    </form>
  );
}
