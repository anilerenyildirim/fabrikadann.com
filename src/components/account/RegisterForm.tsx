"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction } from "@/app/(magaza)/actions/auth";
import { Button, Checkbox, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { StateNotice, useFocusFirstError } from "./form-helpers";
import { PasswordField } from "./PasswordField";

export function RegisterForm({ returnTo }: { returnTo?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(registerAction, {});
  const ref = useFocusFirstError(state);
  const errors = state.fieldErrors ?? {};
  const v = state.values ?? {};

  return (
    <form ref={ref} action={action} noValidate className="flex flex-col gap-6">
      <StateNotice state={state} />
      {returnTo && <input type="hidden" name="sonra" value={returnTo} />}
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Ad"
          name="firstName"
          autoComplete="given-name"
          maxLength={60}
          defaultValue={v.firstName}
          error={errors.firstName}
          required
        />
        <TextField
          label="Soyad"
          name="lastName"
          autoComplete="family-name"
          maxLength={60}
          defaultValue={v.lastName}
          error={errors.lastName}
          required
        />
      </div>
      <TextField
        label="E-posta"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={254}
        defaultValue={v.email}
        error={errors.email}
        required
      />
      <PasswordField
        label="Parola"
        name="password"
        autoComplete="new-password"
        maxLength={128}
        hint="En az 10 karakter."
        error={errors.password}
        required
      />
      <Checkbox
        name="kvkk"
        defaultChecked={v.kvkk === "on"}
        error={errors.kvkk}
        required
        label={
          <>
            <Link href="/kvkk" target="_blank" rel="noopener" className="underline underline-offset-4">
              KVKK aydınlatma metnini
              <span className="sr-only"> (yeni sekmede açılır)</span>
            </Link>{" "}
            okudum.
          </>
        }
      />
      <Button type="submit" full disabled={pending} aria-disabled={pending}>
        {pending ? "Hesap oluşturuluyor…" : "Hesap oluştur"}
      </Button>
    </form>
  );
}
