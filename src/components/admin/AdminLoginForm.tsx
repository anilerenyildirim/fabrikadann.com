"use client";

import { useActionState, useState } from "react";
import { adminLoginAction } from "@/app/yonetim/giris/actions";
import { Button, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { StateNotice, useFocusFirstError } from "./forms";

export function AdminLoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(adminLoginAction, {});
  const ref = useFocusFirstError(state);
  const [showPassword, setShowPassword] = useState(false);
  const errors = state.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} noValidate className="flex flex-col gap-6">
      <StateNotice state={state} />
      <TextField
        label="E-posta"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={254}
        defaultValue={state.values?.email}
        error={errors.email}
        required
      />
      <div className="relative">
        <TextField
          label="Parola"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={128}
          error={errors.password}
          required
          style={{ paddingRight: "4.5rem" }}
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-controls="alan-password"
          aria-label={showPassword ? "Parolayı gizle" : "Parolayı göster"}
          className="label absolute right-0 top-4 flex min-h-11 min-w-11 items-center justify-end text-graphite hover:text-ink"
        >
          {showPassword ? "Gizle" : "Göster"}
        </button>
      </div>
      <Button type="submit" full disabled={pending}>
        {pending ? "Kontrol ediliyor…" : "Devam et"}
      </Button>
    </form>
  );
}
