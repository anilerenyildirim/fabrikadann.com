"use client";

import { useActionState } from "react";
import { forgotPasswordAction } from "@/app/(magaza)/actions/auth";
import { Button, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { StateNotice, useFocusFirstError } from "./form-helpers";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(forgotPasswordAction, {});
  const ref = useFocusFirstError(state);

  return (
    <form ref={ref} action={action} noValidate className="flex flex-col gap-6">
      <StateNotice state={state} />
      <TextField
        label="E-posta"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={254}
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
        required
      />
      <Button type="submit" full disabled={pending} aria-disabled={pending}>
        {pending ? "Gönderiliyor…" : state.ok ? "Bağlantıyı yeniden gönder" : "Sıfırlama bağlantısı gönder"}
      </Button>
    </form>
  );
}
