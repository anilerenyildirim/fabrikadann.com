"use client";

import { useActionState } from "react";
import { Button, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { StateNotice, type FormAction } from "./forms";

const LABELS: Record<string, string> = {
  ANTHROPIC_API_KEY: "Claude API anahtarı",
  N11_API_KEY: "N11 API anahtarı",
  N11_API_SECRET: "N11 API şifresi",
};

/** Yeni anahtar girişi: kaydetmeden önce denenir. Alanlar hata sonrası geri doldurulmaz. */
export function IntegrationKeyForm({ id, names, action }: { id: string; names: string[]; action: FormAction }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4" autoComplete="off">
      <StateNotice state={state} />
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-4 sm:grid-cols-2">
        {names.map((n) => (
          <TextField
            key={`${n}-${state.ok ? "ok" : "x"}`}
            label={LABELS[n] ?? n}
            name={n}
            type="password"
            autoComplete="off"
            spellCheck={false}
            error={state.fieldErrors?.[n]}
          />
        ))}
      </div>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Deneniyor…" : "Dene ve kaydet"}
      </Button>
    </form>
  );
}

export function ExpiryForm({ id, value, action }: { id: string; value: string | null; action: FormAction }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <StateNotice state={state} />
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="Son kullanma tarihi" name="expiresAt" type="date" defaultValue={value ?? ""} error={state.fieldErrors?.expiresAt} />
        <Button type="submit" variant="secondary" disabled={pending} className="min-h-11 px-4">
          {pending ? "Kaydediliyor…" : "Tarihi kaydet"}
        </Button>
      </div>
    </form>
  );
}
