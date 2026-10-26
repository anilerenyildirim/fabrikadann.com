"use client";

import { useActionState, useId, useState } from "react";
import { Button, TextArea } from "@/components/ui/form";
import type { BulkResult } from "@/server/services/admin/bulk-stock";
import type { FormState } from "@/lib/form";
import { firstError, InlineError, InlineOk, useSubmitWithoutReset } from "./forms";
import { table, TableWrap, td, th } from "./table";

type BulkState = FormState & { result?: BulkResult };

const EXAMPLE = "SKU; Barkod; Stok\nFD-001-0-40; 8680000000017; 12\nFD-001-0-41; 8680000000024;\nFD-001-0-42; ; 3";

/**
 * Toplu barkod ve stok girişi. Önce "Kontrol et" ile önizlenir; hatasızsa "Uygula" hepsini birlikte yazar.
 * Form sıfırlanmaz: yapıştırılan liste ve seçimler hata/önizleme sonrası yerinde kalır.
 */
export function BulkStockForm({ action }: { action: (prev: BulkState, form: FormData) => Promise<BulkState> }) {
  const [state, formAction, pending] = useActionState<BulkState, FormData>(action, {});
  const submit = useSubmitWithoutReset(formAction);
  const id = useId();
  const r = state.result;
  const e = state.fieldErrors ?? {};
  const physical = (state.values?.mode ?? "physical") === "physical";
  // Önizlemeden sonra liste ya da seçim değişirse "Güncelle" gizlenir: yalnızca görülen liste uygulanır
  const [editedAfter, setEditedAfter] = useState<BulkState | null>(null);
  const edited = editedAfter === state;
  const canApply = !!r && !r.applied && r.errors.length === 0 && r.changes.length > 0 && !edited;

  return (
    <form action={formAction} onSubmit={submit} onChange={() => setEditedAfter(state)} className="flex flex-col gap-4">
      {canApply && r.fingerprint && <input type="hidden" name="onizleme" value={r.fingerprint} />}
      <TextArea
        label="Satırlar (SKU; barkod; stok)"
        name="satirlar"
        rows={8}
        spellCheck={false}
        placeholder={EXAMPLE}
        defaultValue={state.values?.satirlar}
        error={e.satirlar}
        className="[&_textarea]:font-mono [&_textarea]:text-[0.8125rem]"
      />
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex flex-col">
          <label htmlFor={`${id}-tur`} className="label text-graphite">
            Stok sütunu
          </label>
          <select
            id={`${id}-tur`}
            name="mode"
            defaultValue={state.values?.mode ?? "physical"}
            className="min-h-11 rounded-none border-0 border-b border-ash bg-transparent py-2 pr-1 text-[0.8125rem] outline-none focus:border-ink"
          >
            <option value="physical">Depo sayımı</option>
            <option value="available">Satılabilir</option>
          </select>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <label htmlFor={`${id}-not`} className="label text-graphite">
            Sebep (stok değişiyorsa)
          </label>
          <input
            id={`${id}-not`}
            name="note"
            maxLength={200}
            defaultValue={state.values?.note}
            placeholder="ör. Açılış sayımı"
            className="min-h-11 w-full min-w-0 border-0 border-b border-ash bg-transparent py-2 text-[0.8125rem] outline-none focus:border-ink"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="islem" value="onizle" variant="secondary" disabled={pending}>
          {pending ? "Kontrol ediliyor…" : "Kontrol et"}
        </Button>
        {canApply && (
          <Button type="submit" name="islem" value="uygula" disabled={pending}>
            {`${r.changes.length} numarayı güncelle`}
          </Button>
        )}
      </div>
      <InlineError message={firstError(state, ["satirlar", "note"])} />
      <InlineOk message={state.ok ? state.message : undefined} />

      {r && r.errors.length > 0 && (
        <div role="alert" className="border-y border-ink py-3 text-[0.8125rem]">
          <p className="font-medium">Düzeltilmesi gereken {r.errors.length} satır var; hiçbir değişiklik yapılmadı.</p>
          <ul className="mt-2 list-disc pl-5">
            {r.errors.slice(0, 50).map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
          {r.errors.length > 50 && <p className="mt-2 text-graphite">… ve {r.errors.length - 50} hata daha.</p>}
        </div>
      )}

      {edited && r && !r.applied && (
        <p className="text-[0.8125rem] text-graphite">Liste değişti; uygulamadan önce yeniden “Kontrol et”e basın.</p>
      )}

      {r && !r.applied && r.errors.length === 0 && !edited && (
        <p className="text-[0.8125rem] text-graphite">
          {r.changes.length === 0
            ? "Listede değişiklik yok: barkodlar ve stoklar zaten bu değerlerde."
            : `${r.barcodeChanges} barkod ve ${r.stockChanges} stok değişecek. Kontrol edip “Güncelle”ye basın.`}
        </p>
      )}

      {r && r.changes.length > 0 && (
        <TableWrap label="Toplu güncelleme önizlemesi">
          <table className={`${table} min-w-[720px]`}>
            <thead>
              <tr>
                <th className={th}>Satır</th>
                <th className={th}>SKU</th>
                <th className={th}>Numara</th>
                <th className={th}>Barkod</th>
                <th className={`${th} text-right`}>{physical ? "Sayım" : "Stok"}</th>
              </tr>
            </thead>
            <tbody>
              {r.changes.slice(0, 200).map((c) => (
                <tr key={c.sku}>
                  <td className={`${td} tabular text-graphite`}>{c.line}</td>
                  <td className={`${td} tabular`}>{c.sku}</td>
                  <td className={`${td} max-w-64 truncate`}>{c.label}</td>
                  <td className={`${td} tabular`}>
                    {c.barcodeTo === c.barcodeFrom ? (
                      <span className="text-graphite">{c.barcodeFrom ?? "—"}</span>
                    ) : (
                      <>
                        <span className="text-graphite">{c.barcodeFrom ?? "—"} → </span>
                        {c.barcodeTo}
                      </>
                    )}
                  </td>
                  <td className={`${td} tabular text-right`}>
                    {c.stockValue === undefined ? (
                      <span className="text-graphite">{c.stockFrom}</span>
                    ) : (
                      <>
                        <span className="text-graphite">{c.stockFrom} → </span>
                        {physical ? `sayım ${c.stockValue}` : c.stockValue}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </form>
  );
}
