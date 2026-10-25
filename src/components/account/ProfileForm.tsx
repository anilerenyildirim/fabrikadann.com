"use client";

import { useActionState } from "react";
import { updateProfileAction } from "@/app/(magaza)/actions/account";
import { Button, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { StateNotice, useFocusFirstError } from "./form-helpers";

type Initial = { firstName: string; lastName: string; phone: string };

export function ProfileForm({ initial }: { initial: Initial }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProfileAction, {});
  const ref = useFocusFirstError(state);
  const errors = state.fieldErrors ?? {};
  const v = { ...initial, ...state.values };

  return (
    <form ref={ref} action={action} noValidate className="flex flex-col gap-6">
      <StateNotice state={state} />
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
        label="Telefon"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="05xx xxx xx xx"
        maxLength={20}
        defaultValue={v.phone}
        error={errors.phone}
        hint="İsteğe bağlı. Siparişinizle ilgili size ulaşabilmemiz için."
      />
      <div>
        <Button type="submit" disabled={pending} aria-disabled={pending} className="w-full sm:w-auto">
          {pending ? "Kaydediliyor…" : "Bilgileri kaydet"}
        </Button>
      </div>
    </form>
  );
}
