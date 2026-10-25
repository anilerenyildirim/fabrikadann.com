"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPasswordAction } from "@/app/(magaza)/actions/auth";
import { Button } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { StateNotice, useFocusFirstError } from "./form-helpers";
import { PasswordField } from "./PasswordField";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPasswordAction, {});
  const ref = useFocusFirstError(state);
  const errors = state.fieldErrors ?? {};

  return (
    <form ref={ref} action={action} noValidate className="flex flex-col gap-6">
      <StateNotice state={state}>
        <p className="mt-2">
          <Link href="/sifremi-unuttum" className="underline underline-offset-4">
            Yeni bağlantı iste
          </Link>
        </p>
      </StateNotice>
      <input type="hidden" name="token" value={token} />
      <PasswordField
        label="Yeni parola"
        name="password"
        autoComplete="new-password"
        maxLength={128}
        hint="En az 10 karakter."
        error={errors.password}
        required
      />
      <PasswordField
        label="Yeni parola (tekrar)"
        name="passwordRepeat"
        autoComplete="new-password"
        maxLength={128}
        error={errors.passwordRepeat}
        required
      />
      <Button type="submit" full disabled={pending} aria-disabled={pending}>
        {pending ? "Kaydediliyor…" : "Parolayı değiştir"}
      </Button>
    </form>
  );
}
