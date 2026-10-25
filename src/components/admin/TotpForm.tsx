"use client";

import { useActionState } from "react";
import { adminTotpAction } from "@/app/yonetim/iki-adim/actions";
import { Button, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { StateNotice, useFocusFirstError } from "./forms";

export function TotpForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(adminTotpAction, {});
  const ref = useFocusFirstError(state);
  return (
    <form ref={ref} action={action} noValidate className="flex flex-col gap-6">
      <StateNotice state={state} />
      <TextField
        label="Doğrulama kodu"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        autoFocus
        required
        error={state.fieldErrors?.code}
        hint="Google Authenticator, 1Password ya da kullandığınız uygulamadaki 6 haneli kod."
        className="[&_input]:[font-variant-numeric:tabular-nums] [&_input]:text-xl [&_input]:tracking-[0.3em]"
      />
      <Button type="submit" full disabled={pending}>
        {pending ? "Doğrulanıyor…" : "Doğrula ve panele gir"}
      </Button>
    </form>
  );
}
