"use client";

import { useActionState } from "react";
import { Button, Checkbox, TextArea, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { LooseFieldErrors, StateNotice, useFocusFirstError, type FormAction } from "./forms";

export type ManufacturerValues = {
  id?: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  taxOffice: string;
  taxNumber: string;
  address: string;
  iban: string;
  note: string;
  openingBalance: string;
  active: boolean;
};

const FIELDS = ["name", "contactName", "phone", "email", "taxOffice", "taxNumber", "address", "iban", "note", "openingBalance", "active"];

export function ManufacturerForm({ action, initial }: { action: FormAction; initial: ManufacturerValues }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const ref = useFocusFirstError(state);
  const e = state.fieldErrors ?? {};
  const isNew = !initial.id;
  const v = (k: keyof ManufacturerValues) => state.values?.[k] ?? String(initial[k] ?? "");
  return (
    <form ref={ref} action={formAction} noValidate className="flex max-w-2xl flex-col gap-7">
      <StateNotice state={state} />
      <LooseFieldErrors state={state} known={FIELDS} />
      {initial.id && <input type="hidden" name="manufacturerId" value={initial.id} />}
      <TextField label="Üretici adı" name="name" required maxLength={120} defaultValue={v("name")} error={e.name} />
      <div className="grid gap-7 sm:grid-cols-2">
        <TextField label="Yetkili" name="contactName" maxLength={120} defaultValue={v("contactName")} error={e.contactName} />
        <TextField label="Telefon" name="phone" type="tel" maxLength={40} defaultValue={v("phone")} error={e.phone} />
        <TextField label="E-posta" name="email" type="email" maxLength={200} defaultValue={v("email")} error={e.email} />
        <TextField
          label="IBAN"
          name="iban"
          maxLength={40}
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="TR00 0000 0000 0000 0000 0000 00"
          defaultValue={v("iban")}
          error={e.iban}
        />
        <TextField label="Vergi dairesi" name="taxOffice" maxLength={80} defaultValue={v("taxOffice")} error={e.taxOffice} />
        <TextField
          label="Vergi no / TC kimlik no"
          name="taxNumber"
          inputMode="numeric"
          maxLength={11}
          defaultValue={v("taxNumber")}
          error={e.taxNumber}
        />
      </div>
      <TextArea label="Adres" name="address" rows={2} maxLength={500} defaultValue={v("address")} error={e.address} />
      <TextField
        label="Devir bakiyesi (TL)"
        name="openingBalance"
        inputMode="decimal"
        placeholder="0,00"
        defaultValue={v("openingBalance")}
        error={e.openingBalance}
        hint="Sisteme geçmeden önce bu üreticiye olan borcunuz. Üretici size borçluysa başına - yazın."
        className="sm:max-w-xs [&_input]:[font-variant-numeric:tabular-nums]"
      />
      <TextArea label="Not" name="note" rows={3} maxLength={1000} defaultValue={v("note")} error={e.note} />
      {!isNew && (
        <Checkbox
          label="Etkin (pasif üretici yeni ürüne ve mal alımına seçilemez; geçmiş kayıtları kalır)"
          name="active"
          defaultChecked={state.values ? state.values.active === "on" : initial.active}
        />
      )}
      <div>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Kaydediliyor…" : isNew ? "Üreticiyi ekle" : "Bilgileri kaydet"}
        </Button>
      </div>
    </form>
  );
}
