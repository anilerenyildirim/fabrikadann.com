"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, Checkbox, FormNotice } from "@/components/ui/form";
import { formatPrice } from "@/lib/money";
import type { FormState } from "@/lib/form";

const MAX_SELECTED = 8;

export type ImportCandidateView = {
  productMainId: string;
  name: string;
  categoryName: string | null;
  colorNames: string[];
  sizes: string[];
  newItems: number;
  newStock: number;
  existingItems: number;
  problems: { barcode: string; reason: string }[];
  trendyolPrice: number | null;
  sitePrice: number | null;
  siteProduct: { id: string; name: string } | null;
};

type ResultView = {
  productMainId: string;
  name: string;
  status: "created" | "updated" | "skipped" | "failed";
  productId?: string;
  added: string[];
  problems: { barcode: string; reason: string }[];
  imageErrors: number;
  message?: string;
};

type State = FormState & { results?: ResultView[] };

const STATUS_LABEL: Record<ResultView["status"], string> = {
  created: "Taslak oluşturuldu",
  updated: "Mevcut ürüne eklendi",
  skipped: "Atlandı",
  failed: "Aktarılamadı",
};

export function TrendyolImportForm({
  action,
  candidates,
}: {
  action: (prev: State, form: FormData) => Promise<State>;
  candidates: ImportCandidateView[];
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, {});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Aktarım bitince seçim temizlenir (aktarılanlar listede "Tümü sitede" olur)
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok) setSelected(new Set());
  }
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const tooMany = selected.size > MAX_SELECTED;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.error && <FormNotice>{state.error}</FormNotice>}
      {state.ok && state.message && <FormNotice tone="info">{state.message}</FormNotice>}
      {state.results && state.results.length > 0 && <Results results={state.results} />}

      <ul className="border-t border-ink">
        {candidates.map((c) => {
          const importable = c.newItems > 0;
          return (
            <li key={c.productMainId} className="border-b border-rule py-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  id={`aktar-${c.productMainId}`}
                  name="mainId"
                  value={c.productMainId}
                  disabled={!importable || pending}
                  checked={selected.has(c.productMainId)}
                  onChange={(e) => toggle(c.productMainId, e.currentTarget.checked)}
                  label={<span className="sr-only">{c.name}</span>}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1 py-2 text-[0.8125rem]">
                  <p className="font-medium [overflow-wrap:anywhere]">{c.name}</p>
                  <p className="mt-1 text-graphite [overflow-wrap:anywhere]">
                    {c.categoryName ?? "Kategorisiz"} · {c.colorNames.join(", ") || "renk yok"} · {c.sizes.length} numara
                    {" · "}Model kodu {c.productMainId}
                  </p>
                  <p className="tabular mt-1">
                    {c.trendyolPrice !== null ? (
                      <>
                        Trendyol {formatPrice(c.trendyolPrice)}
                        {c.sitePrice !== null && !c.siteProduct && <> → site {formatPrice(c.sitePrice)} (%25 indirim)</>}
                      </>
                    ) : (
                      <span className="text-graphite">Trendyol fiyatı yok</span>
                    )}
                  </p>
                  <p className="mt-1 text-graphite">
                    {importable ? (
                      <>
                        {c.newItems} yeni numara, toplam <span className="tabular">{c.newStock}</span> adet stok
                        {c.existingItems > 0 && <> · {c.existingItems} numara zaten sitede</>}
                      </>
                    ) : (
                      <span className="label">Tümü sitede</span>
                    )}
                    {c.siteProduct && (
                      <>
                        {" · "}
                        <Link href={`/yonetim/urunler/${c.siteProduct.id}`} className="inline-flex min-h-11 items-center text-ink underline underline-offset-4">
                          Sitedeki ürün: {c.siteProduct.name}
                        </Link>
                      </>
                    )}
                  </p>
                  {c.problems.length > 0 && (
                    <ul className="mt-1 text-graphite">
                      {c.problems.map((p) => (
                        <li key={p.barcode} className="[overflow-wrap:anywhere]">
                          {p.barcode}: {p.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-ink bg-paper py-3">
        <Button type="submit" disabled={pending || selected.size === 0 || tooMany} className="w-full sm:w-auto">
          {pending ? "Aktarılıyor… (görseller indiriliyor)" : `Seçilenleri taslak olarak aktar (${selected.size})`}
        </Button>
        {tooMany && <p className="text-[0.8125rem]">Tek seferde en fazla {MAX_SELECTED} ürün aktarılabilir.</p>}
      </div>
    </form>
  );
}

function Results({ results }: { results: ResultView[] }) {
  return (
    <section aria-label="Aktarım sonucu" className="border border-rule p-4 text-[0.8125rem]">
      <h2 className="label mb-3">Aktarım sonucu</h2>
      <ul className="flex flex-col gap-3">
        {results.map((r) => (
          <li key={r.productMainId}>
            <p className="[overflow-wrap:anywhere]">
              <span className="label mr-2">{STATUS_LABEL[r.status]}</span>
              {r.productId ? (
                <Link href={`/yonetim/urunler/${r.productId}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                  {r.name}
                </Link>
              ) : (
                r.name
              )}
            </p>
            {r.added.length > 0 && <p className="text-graphite">Eklenen numaralar: {r.added.join(", ")}</p>}
            {r.message && <p className="text-graphite">{r.message}</p>}
            {r.imageErrors > 0 && <p className="text-graphite">{r.imageErrors} görsel indirilemedi; ürün sayfasından elle yükleyin.</p>}
            {r.problems.length > 0 && (
              <ul className="text-graphite">
                {r.problems.map((p) => (
                  <li key={p.barcode} className="[overflow-wrap:anywhere]">
                    {p.barcode}: {p.reason}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
