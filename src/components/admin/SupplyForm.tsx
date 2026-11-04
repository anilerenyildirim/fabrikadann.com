"use client";

import Link from "next/link";
import { useActionState, useId, useRef } from "react";
import { Button } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { formatPrice } from "@/lib/money";
import type { SupplyRow } from "@/server/services/admin/supply";
import { InlineError, StateNotice, useSubmitWithoutReset, type FormAction } from "./forms";
import { table, TableWrap, td, th } from "./table";

type Option = { id: string; name: string; active: boolean };

const STATUS: Record<SupplyRow["status"], string> = { active: "Yayında", draft: "Taslak", archived: "Arşivde" };

const priceText = (k: number | null) => (k === null ? "" : formatPrice(k).replace(/\s*TL$/, ""));
const fieldClass =
  "min-h-11 w-full min-w-0 rounded-none border-0 border-b bg-transparent py-2 text-[0.8125rem] outline-none focus:border-ink";

/**
 * Ürünlerin üreticisi ve alış fiyatı tek tabloda. Form sıfırlanmaz (seçimler hata sonrası yerinde kalır);
 * kaydedilince yalnızca değişen satırlar yazılır. Alış fişi olan ürünün üreticisi kilitlidir.
 */
export function SupplyForm({ rows, manufacturers, action }: { rows: SupplyRow[]; manufacturers: Option[]; action: FormAction }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const submit = useSubmitWithoutReset(formAction);
  const formRef = useRef<HTMLFormElement>(null);
  const fillRef = useRef<HTMLSelectElement>(null);
  const id = useId();
  const errors = state.fieldErrors ?? {};
  const active = manufacturers.filter((m) => m.active);

  function fillEmpty() {
    const value = fillRef.current?.value;
    if (!value || !formRef.current) return;
    formRef.current.querySelectorAll<HTMLSelectElement>("select[data-uretici]:not(:disabled)").forEach((s) => {
      if (s.value === "") s.value = value;
    });
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={submit} className="flex flex-col gap-5">
      <StateNotice state={state} />

      {active.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col">
            <label htmlFor={`${id}-doldur`} className="label text-graphite">
              Üreticisi boş olanlara
            </label>
            <select id={`${id}-doldur`} ref={fillRef} defaultValue="" className={`${fieldClass} border-ash pr-1 sm:w-64`}>
              <option value="">Üretici seçin</option>
              {active.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" variant="secondary" onClick={fillEmpty} className="min-h-11 px-4">
            Boş satırlara uygula
          </Button>
        </div>
      )}

      <TableWrap label="Ürünlerin üreticisi ve alış fiyatı">
        <table className={`${table} min-w-[680px]`}>
          <thead>
            <tr>
              <th className={th}>Ürün</th>
              <th className={th}>Üretici</th>
              <th className={`${th} w-36`}>Alış fiyatı (TL)</th>
              <th className={`${th} text-right`}>Satış</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const error = errors[`satir-${r.productId}`];
              return (
                <tr key={r.productId}>
                  <td className={td}>
                    <input type="hidden" name="id" value={r.productId} />
                    <Link
                      href={`/yonetim/urunler/${r.productId}`}
                      className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="flex flex-wrap items-center gap-x-2 text-[0.75rem] text-graphite">
                      <span className="label">{STATUS[r.status]}</span>
                      {r.category}
                    </span>
                    <InlineError message={error} />
                  </td>
                  <td className={td}>
                    <select
                      name={`m-${r.productId}`}
                      data-uretici
                      defaultValue={r.manufacturerId ?? ""}
                      disabled={r.locked}
                      aria-label={`${r.name} üreticisi`}
                      aria-invalid={error ? true : undefined}
                      className={`${fieldClass} pr-1 ${error ? "border-b-2 border-ink" : "border-ash"} disabled:text-graphite`}
                    >
                      <option value="">Seçilmedi</option>
                      {manufacturers.map((m) => (
                        <option key={m.id} value={m.id} disabled={!m.active && m.id !== r.manufacturerId}>
                          {m.name}
                          {m.active ? "" : " (pasif)"}
                        </option>
                      ))}
                    </select>
                    {/* Kilitli satırda seçim kutusu gönderilmez; mevcut üretici gizli alanla korunur */}
                    {r.locked && <input type="hidden" name={`m-${r.productId}`} value={r.manufacturerId ?? ""} />}
                    {r.locked && <span className="block text-[0.75rem] text-graphite">Alış fişi var; değişmez</span>}
                  </td>
                  <td className={td}>
                    <input
                      name={`p-${r.productId}`}
                      defaultValue={priceText(r.purchasePrice)}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="850,00"
                      aria-label={`${r.name} alış fiyatı`}
                      aria-invalid={error ? true : undefined}
                      className={`${fieldClass} tabular ${error ? "border-b-2 border-ink" : "border-ash"}`}
                    />
                  </td>
                  <td className={`${td} tabular whitespace-nowrap text-right`}>{formatPrice(r.price)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Kaydediliyor" : "Değişiklikleri kaydet"}
        </Button>
      </div>
    </form>
  );
}
