"use client";

import { useActionState, useState } from "react";
import { Button, SelectField, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { LooseFieldErrors, StateNotice, useFocusFirstError, useSubmitWithoutReset, useSuccessKey, type FormAction } from "./forms";

type Option = Record<string, string>;

const FIELDS = ["kind", "category", "date", "amount", "method", "description", "manufacturerId"];
const MANUFACTURER_CATEGORIES = ["manufacturer_payment", "manufacturer_refund"];

/**
 * Gelir ya da gider kaydı. manufacturer verilirse yalnızca o üreticinin ödeme/tahsilat formu olur.
 */
export function LedgerEntryForm({
  action,
  incomeCategories,
  expenseCategories,
  methods,
  manufacturers,
  manufacturer,
  today,
}: {
  action: FormAction;
  incomeCategories: Option;
  expenseCategories: Option;
  methods: Option;
  manufacturers: { id: string; name: string }[];
  manufacturer?: { id: string; name: string };
  today: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const ref = useFocusFirstError(state);
  const submit = useSubmitWithoutReset(formAction);
  // Başarıdan sonra alanlar boşalsın (form sıfırlanmıyor)
  const key = useSuccessKey(state);
  const e = state.fieldErrors ?? {};
  const keep = state.ok ? undefined : state.values;
  const [category, setCategory] = useState(keep?.category ?? (manufacturer ? "manufacturer_payment" : "shipping"));
  const kind = category in incomeCategories ? "income" : "expense";
  const needsManufacturer = MANUFACTURER_CATEGORIES.includes(category);
  const options = manufacturer
    ? Object.fromEntries(MANUFACTURER_CATEGORIES.map((k) => [k, { ...incomeCategories, ...expenseCategories }[k]!]))
    : null;

  return (
    <form ref={ref} action={formAction} onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-6" key={key}>
      <StateNotice state={state} />
      <LooseFieldErrors state={state} known={FIELDS} />
      <input type="hidden" name="kind" value={kind} />
      {manufacturer && <input type="hidden" name="manufacturerId" value={manufacturer.id} />}
      <div className="grid gap-6 sm:grid-cols-2">
        <SelectField
          label={manufacturer ? "İşlem" : "Kategori"}
          name="category"
          value={category}
          onChange={(ev) => setCategory(ev.currentTarget.value)}
          error={e.category}
        >
          {options ? (
            Object.entries(options).map(([k, label]) => (
              <option key={k} value={k}>
                {k === "manufacturer_payment" ? `${label} (borçtan düşer)` : `${label} (borca ekler)`}
              </option>
            ))
          ) : (
            <>
              <optgroup label="Gider">
                {Object.entries(expenseCategories).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Gelir">
                {Object.entries(incomeCategories).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </optgroup>
            </>
          )}
        </SelectField>
        {!manufacturer && needsManufacturer && (
          <SelectField label="Üretici" name="manufacturerId" defaultValue={keep?.manufacturerId ?? ""} error={e.manufacturerId}>
            <option value="">Üretici seçin</option>
            {manufacturers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </SelectField>
        )}
        <TextField
          label="Tutar (TL)"
          name="amount"
          inputMode="decimal"
          required
          placeholder="1.250,00"
          defaultValue={keep?.amount ?? ""}
          error={e.amount}
          className="[&_input]:[font-variant-numeric:tabular-nums]"
        />
        <TextField label="Tarih" name="date" type="date" required max={today} defaultValue={keep?.date ?? today} error={e.date} />
        <SelectField label="Ödeme şekli" name="method" defaultValue={keep?.method ?? "bank"} error={e.method}>
          {Object.entries(methods).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField
        label="Açıklama (isteğe bağlı)"
        name="description"
        maxLength={300}
        placeholder={needsManufacturer ? "ör. Ekim ayı ödemesi, dekont no" : "ör. Ekim kargo faturası"}
        defaultValue={keep?.description ?? ""}
        error={e.description}
      />
      <div>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Kaydediliyor…" : kind === "income" ? "Geliri kaydet" : category === "manufacturer_payment" ? "Ödemeyi kaydet" : "Gideri kaydet"}
        </Button>
      </div>
    </form>
  );
}
