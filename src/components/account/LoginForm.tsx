"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/app/(magaza)/actions/auth";
import { Button, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { StateNotice, useFocusFirstError } from "./form-helpers";
import { PasswordField } from "./PasswordField";

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  const ref = useFocusFirstError(state);
  const errors = state.fieldErrors ?? {};

  return (
    <form ref={ref} action={action} noValidate className="flex flex-col gap-6">
      <StateNotice state={state} />
      {returnTo && <input type="hidden" name="sonra" value={returnTo} />}
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
        error={errors.email}
        required
      />
      <PasswordField
        label="Parola"
        name="password"
        autoComplete="current-password"
        maxLength={128}
        error={errors.password}
        required
      />
      <div className="-mt-4">
        <Link
          href="/sifremi-unuttum"
          className="inline-flex min-h-11 items-center text-[0.8125rem] underline underline-offset-4 hover:no-underline"
        >
          Parolamı unuttum
        </Link>
      </div>
      <Button type="submit" full disabled={pending} aria-disabled={pending}>
        {pending ? "Giriş yapılıyor…" : "Giriş yap"}
      </Button>
    </form>
  );
}
