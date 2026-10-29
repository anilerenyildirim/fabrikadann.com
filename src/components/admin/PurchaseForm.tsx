"use client";

import { useActionState, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, ErrorMark, FormNotice, SelectField, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { formatPrice, parsePriceToKurus } from "@/lib/money";
import { firstError, useSubmitWithoutReset, type FormAction } from "./forms";

type Variant = { id: string; size: string; productionBarcode: string; stock: number };
type Product = { id: string; name: string; purchasePrice: number | null; colors: { id: string; name: string; variants: Variant[] }[] };

const priceInput = (k: number | null) => (k === null ? "" : formatPrice(k).replace(/\s*TL$/, ""));
const qtyOf = (s: string | undefined) => {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
/** Boş ya da 0 değilse ve pozitif tam sayı değilse hatalı (ör. "1,5"): satır sessizce düşmesin */
const qtyBad = (s: string | undefined) => !!s && s.trim() !== "" && s.trim() !== "0" && qtyOf(s) === 0;

/**
 * Mal alımı / iade fişi. Adetler numara numara girilir ya da barkod okutulur (okuyucu klavye gibi yazar ve Enter'a basar).
 */
export function PurchaseForm({
  action,
  manufacturer,
  products,
  today,
}: {
  action: FormAction;
  manufacturer: { id: string; name: string };
  products: Product[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const [kind, setKind] = useState<"purchase" | "return">((state.values?.kind as "return") ?? "purchase");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>(() =>
    Object.fromEntries(products.map((p) => [p.id, priceInput(p.purchasePrice)])),
  );
  const [filter, setFilter] = useState("");
  const [scanMessage, setScanMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  // Aynı fişin iki kez kaydedilmesini önler (çift tıklama, ağ tekrarı); sayfa yenilenince yeni kimlik
  const [requestId] = useState(() => crypto.randomUUID());

  const byBarcode = useMemo(() => {
    const map = new Map<string, { product: Product; color: string; variant: Variant }>();
    for (const p of products) for (const c of p.colors) for (const v of c.variants) map.set(v.productionBarcode, { product: p, color: c.name, variant: v });
    return map;
  }, [products]);

  const lines = products.flatMap((p) =>
    p.colors.flatMap((c) =>
      c.variants
        .filter((v) => qtyOf(qty[v.id]) > 0)
        .map((v) => ({ product: p, color: c.name, variant: v, quantity: qtyOf(qty[v.id]), unitCost: parsePriceToKurus(costs[p.id] ?? "") })),
    ),
  );
  const pairs = lines.reduce((n, l) => n + l.quantity, 0);
  const total = lines.reduce((n, l) => n + (Number.isNaN(l.unitCost) ? 0 : l.unitCost * l.quantity), 0);
  const badCost = [...new Set(lines.filter((l) => Number.isNaN(l.unitCost)).map((l) => l.product.name))];
  const overStock = kind === "return" ? lines.filter((l) => l.quantity > l.variant.stock) : [];
  const badQty = products.some((p) => p.colors.some((c) => c.variants.some((v) => qtyBad(qty[v.id]))));

  const submitBase = useSubmitWithoutReset(formAction);
  const submit: typeof submitBase = (event) => {
    setClientError(null);
    if (badQty) {
      event.preventDefault();
      setClientError("Adetleri tam sayı olarak yazın (ör. 3). Hatalı kutular kalın çizgiyle işaretli.");
      return;
    }
    if (lines.length === 0) {
      event.preventDefault();
      setClientError("En az bir numara için adet girin.");
      return;
    }
    if (badCost.length) {
      event.preventDefault();
      setClientError(`Birim maliyeti 850,00 biçiminde yazın: ${badCost.join(", ")}.`);
      return;
    }
    submitBase(event);
  };

  function onScan(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const code = event.currentTarget.value.trim();
    event.currentTarget.value = "";
    if (!code) return;
    const hit = byBarcode.get(code);
    if (!hit) {
      setScanMessage({ text: `${code}: bu üreticinin ürünlerinde bulunamadı.`, error: true });
      return;
    }
    const next = qtyOf(qty[hit.variant.id]) + 1;
    setQty((q) => ({ ...q, [hit.variant.id]: String(next) }));
    setScanMessage({ text: `${hit.product.name} · ${hit.color} · ${hit.variant.size}: ${next} adet` });
  }

  const f = filter.trim().toLocaleLowerCase("tr");
  const visible = f ? products.filter((p) => p.name.toLocaleLowerCase("tr").includes(f)) : products;
  const error = clientError ?? firstError(state);

  return (
    <form action={formAction} onSubmit={submit} noValidate className="flex flex-col gap-8">
      <input type="hidden" name="manufacturerId" value={manufacturer.id} />
      <input type="hidden" name="requestId" value={requestId} />
      <input
        type="hidden"
        name="lines"
        value={JSON.stringify(lines.map((l) => ({ variantId: l.variant.id, quantity: l.quantity, unitCost: l.unitCost })))}
      />
      {error && <FormNotice>{error}</FormNotice>}

      <div className="grid max-w-2xl gap-6 sm:grid-cols-2">
        <SelectField label="Fiş türü" name="kind" value={kind} onChange={(e) => setKind(e.currentTarget.value as "purchase" | "return")}>
          <option value="purchase">Mal alımı — stok artar, borç yazılır</option>
          <option value="return">Üreticiye iade — stok düşer, borç azalır</option>
        </SelectField>
        <TextField
          label="Tarih"
          name="date"
          type="date"
          required
          max={today}
          defaultValue={state.values?.date ?? today}
          error={state.fieldErrors?.date}
        />
        <TextField
          label="Not (isteğe bağlı)"
          name="note"
          maxLength={500}
          placeholder="ör. irsaliye no 12345"
          defaultValue={state.values?.note ?? ""}
          error={state.fieldErrors?.note}
          className="sm:col-span-2"
        />
      </div>

      <div className="grid max-w-2xl gap-6 sm:grid-cols-2">
        <div className="flex flex-col">
          <label htmlFor="barkod-okut" className="label text-graphite">
            Barkod okut
          </label>
          <input
            id="barkod-okut"
            ref={scanRef}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Okutun ya da yazıp Enter'a basın"
            onKeyDown={onScan}
            className="min-h-11 border-0 border-b border-ash bg-transparent px-0 py-2 outline-none placeholder:text-ash focus:border-ink focus:shadow-[0_1px_0_0_var(--color-ink)]"
          />
          <p role="status" className="mt-1.5 flex min-h-5 items-start gap-1.5 text-[0.8125rem] text-graphite">
            {scanMessage?.error && <ErrorMark />}
            <span className={scanMessage?.error ? "text-ink" : ""}>{scanMessage?.text}</span>
          </p>
        </div>
        {products.length > 6 && (
          <TextField id="urun-ara" label="Ürün ara" name="" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} autoComplete="off" />
        )}
      </div>

      <div className="flex flex-col">
        {visible.map((p) => {
          const pPairs = p.colors.reduce((n, c) => n + c.variants.reduce((m, v) => m + qtyOf(qty[v.id]), 0), 0);
          const costBad = pPairs > 0 && Number.isNaN(parsePriceToKurus(costs[p.id] ?? ""));
          return (
            <section key={p.id} className="border-t border-ink py-5" aria-label={p.name}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <h3 className="font-medium">
                  {p.name}
                  {pPairs > 0 && <span className="label tabular ml-3 text-graphite">{pPairs} çift</span>}
                </h3>
                <div className="flex flex-col sm:w-48">
                  <label htmlFor={`maliyet-${p.id}`} className="label text-graphite">
                    Birim maliyet (TL)
                  </label>
                  <input
                    id={`maliyet-${p.id}`}
                    inputMode="decimal"
                    placeholder="850,00"
                    value={costs[p.id] ?? ""}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      setCosts((c) => ({ ...c, [p.id]: value }));
                    }}
                    aria-invalid={costBad || undefined}
                    className={`tabular min-h-11 border-0 border-b bg-transparent px-0 py-2 outline-none focus:border-ink ${costBad ? "border-b-2 border-ink" : "border-ash"}`}
                  />
                </div>
              </div>
              {p.colors.map((c) => (
                <div key={c.id} className="mt-4">
                  <p className="label mb-2 text-graphite">{c.name}</p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-10">
                    {c.variants.map((v) => {
                      const over = (kind === "return" && qtyOf(qty[v.id]) > v.stock) || qtyBad(qty[v.id]);
                      return (
                        <label
                          key={v.id}
                          className={`flex flex-col items-center border px-1 pt-1.5 focus-within:border-ink ${over ? "border-2 border-ink" : "border-rule"}`}
                        >
                          <span className="tabular text-[0.8125rem]">{v.size}</span>
                          <span className="sr-only">
                            {p.name} {c.name} {v.size} adet
                          </span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={10000}
                            value={qty[v.id] ?? ""}
                            placeholder="0"
                            onChange={(e) => {
                              const value = e.currentTarget.value;
                              setQty((q) => ({ ...q, [v.id]: value }));
                            }}
                            aria-invalid={over || undefined}
                            className={`tabular min-h-11 w-full bg-transparent text-center outline-none placeholder:text-ash ${over ? "font-bold underline" : ""}`}
                          />
                          <span className="pb-1 text-[0.6875rem] text-graphite">stok {v.stock}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
        {visible.length === 0 && <p className="border-t border-rule py-6 text-[0.8125rem] text-graphite">Aramaya uyan ürün yok.</p>}
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t border-ink bg-paper px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:mx-0 md:px-0">
        <p className="tabular">
          {pairs} çift · <strong className="font-medium">{formatPrice(total)}</strong>
          {overStock.length > 0 && (
            <span className="mt-1 flex items-start gap-1.5 text-[0.8125rem]">
              <ErrorMark /> İade adedi stoktan fazla: {overStock.map((l) => `${l.product.name} ${l.variant.size}`).join(", ")}
            </span>
          )}
        </p>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Kaydediliyor…" : kind === "purchase" ? "Alış fişini kaydet" : "İade fişini kaydet"}
        </Button>
      </div>
    </form>
  );
}
