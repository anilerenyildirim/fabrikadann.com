"use client";

import { useActionState } from "react";
import { createAddressAction, updateAddressAction } from "@/app/(magaza)/actions/account";
import { AddressFields } from "@/components/ui/AddressFields";
import { Button, ButtonLink } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { StateNotice, useFocusFirstError } from "./form-helpers";

type Values = Partial<Record<"title" | "fullName" | "phone" | "city" | "district" | "line", string>>;

/** Yeni adres (id yok) ya da var olan adresin düzenlenmesi. */
export function AddressForm({ id, initial = {} }: { id?: string; initial?: Values }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    id ? updateAddressAction : createAddressAction,
    {},
  );
  const ref = useFocusFirstError(state);

  return (
    <form ref={ref} action={action} noValidate className="flex flex-col gap-8">
      <StateNotice state={state} />
      {id && <input type="hidden" name="id" value={id} />}
      <AddressFields withTitle values={{ ...initial, ...state.values }} errors={state.fieldErrors ?? {}} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <Button type="submit" disabled={pending} aria-disabled={pending} className="w-full sm:w-auto">
          {pending ? "Kaydediliyor…" : "Adresi kaydet"}
        </Button>
        <ButtonLink href="/hesabim/adresler" variant="quiet" className="self-center">
          Vazgeç
        </ButtonLink>
      </div>
    </form>
  );
}
