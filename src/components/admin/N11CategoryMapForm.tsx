"use client";

import { useEffect, useState } from "react";
import { Button, FormNotice, SelectField, TextField } from "@/components/ui/form";

type Attr = { id: number; name: string; mandatory: boolean; custom: boolean; values: { id: number; value: string }[] };
type Saved = { id: number; valueId: number | null; customValue: string | null };

export type N11MapActions = {
  search: (q: string) => Promise<{ externalId: number; path: string }[]>;
  attributes: (externalId: number) => Promise<{ attributes?: Attr[]; error?: string }>;
  save: (raw: unknown) => Promise<{ ok?: true; error?: string }>;
};

/** Bir site kategorisini N11 kategorisine eşler; seçilen N11 kategorisinin sabit özelliklerini sorar. */
export function N11CategoryMapForm({
  categoryId,
  current,
  actions,
  onDone,
}: {
  categoryId: string;
  current: { externalId: number; path: string; attributes: Saved[] } | null;
  actions: N11MapActions;
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ externalId: number; path: string }[]>([]);
  const [chosen, setChosen] = useState<{ externalId: number; path: string } | null>(current ? { externalId: current.externalId, path: current.path } : null);
  const [attrs, setAttrs] = useState<Attr[] | null>(null);
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries((current?.attributes ?? []).map((a) => [a.id, a.valueId !== null ? `id:${a.valueId}` : (a.customValue ?? "")])),
  );
  const [error, setError] = useState<string | null>(null);
  // Değer olay anında okunur (güncelleyici sonradan çalışır; o zaman currentTarget boştur)
  const setValue = (id: number, value: string) => setValues((p) => ({ ...p, [id]: value }));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => actions.search(q).then(setHits, () => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q, actions]);

  useEffect(() => {
    if (!chosen) return;
    let live = true;
    setAttrs(null);
    actions.attributes(chosen.externalId).then(
      (r) => {
        if (!live) return;
        if (r.error) setError(r.error);
        setAttrs(r.attributes ?? []);
      },
      () => live && setError("Özellikler okunamadı. Yeniden deneyin."),
    );
    return () => {
      live = false;
    };
  }, [chosen, actions]);

  async function save() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const attributes = (attrs ?? [])
      .map((a) => {
        const v = values[a.id]?.trim() ?? "";
        if (!v) return null;
        if (v.startsWith("id:")) return { id: a.id, valueId: Number(v.slice(3)), customValue: null };
        const hit = a.values.find((x) => x.value.toLocaleLowerCase("tr") === v.toLocaleLowerCase("tr"));
        return hit ? { id: a.id, valueId: hit.id, customValue: null } : { id: a.id, valueId: null, customValue: v };
      })
      .filter(Boolean);
    const res = await actions.save({ categoryId, externalCategoryId: chosen.externalId, attributes }).catch(() => ({ error: "Sunucuya ulaşılamadı." }));
    setBusy(false);
    if (res.error) setError(res.error);
    else onDone();
  }

  const shown = (attrs ?? []).filter((a) => a.mandatory || a.values.length > 0).sort((a, b) => Number(b.mandatory) - Number(a.mandatory));

  return (
    <div className="flex flex-col gap-5 border border-rule p-4">
      {error && <FormNotice>{error}</FormNotice>}
      {chosen ? (
        <div className="flex flex-wrap items-center gap-3 text-[0.8125rem]">
          <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <span className="label mr-2">N11</span>
            {chosen.path}
          </p>
          <Button type="button" variant="quiet" onClick={() => (setChosen(null), setAttrs(null))}>
            Başka kategori seç
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <TextField label="N11 kategorisi ara" name="ara" value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="ör. kadın bot" autoComplete="off" />
          {hits.length > 0 && (
            <ul className="border-t border-rule text-[0.8125rem]">
              {hits.map((h) => (
                <li key={h.externalId} className="border-b border-rule">
                  <button type="button" className="min-h-11 w-full px-1 py-2 text-left hover:bg-fog" onClick={() => setChosen(h)}>
                    {h.path}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && hits.length === 0 && <p className="text-[0.8125rem] text-graphite">Eşleşen N11 kategorisi yok. Başka bir kelime deneyin.</p>}
        </div>
      )}

      {chosen && attrs === null && <p className="text-[0.8125rem] text-graphite">Özellikler N11'den okunuyor…</p>}
      {chosen && attrs && (
        <>
          <p className="text-[0.8125rem] text-graphite">
            Bu kategorideki tüm ürünlere aynı değerler yazılır. Marka, renk, numara ve şirket bilgileri kendiliğinden doldurulur.
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            {shown.map((a) =>
              a.custom ? (
                <TextField
                  key={a.id}
                  label={`${a.name}${a.mandatory ? "" : " (isteğe bağlı)"}`}
                  name={`a${a.id}`}
                  list={a.values.length ? `n11-${categoryId}-${a.id}` : undefined}
                  value={values[a.id]?.startsWith("id:") ? (a.values.find((v) => `id:${v.id}` === values[a.id])?.value ?? "") : (values[a.id] ?? "")}
                  onChange={(e) => setValue(a.id, e.currentTarget.value)}
                  hint={
                    a.values.length ? (
                      <datalist id={`n11-${categoryId}-${a.id}`}>
                        {a.values.slice(0, 300).map((v) => (
                          <option key={v.id} value={v.value} />
                        ))}
                      </datalist>
                    ) : undefined
                  }
                />
              ) : (
                <SelectField
                  key={a.id}
                  label={`${a.name}${a.mandatory ? "" : " (isteğe bağlı)"}`}
                  name={`a${a.id}`}
                  value={values[a.id] ?? ""}
                  onChange={(e) => setValue(a.id, e.currentTarget.value)}
                >
                  <option value="">{a.mandatory ? "Seçin" : "Boş bırak"}</option>
                  {a.values.map((v) => (
                    <option key={v.id} value={`id:${v.id}`}>
                      {v.value}
                    </option>
                  ))}
                </SelectField>
              ),
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={save} disabled={busy} className="w-full sm:w-auto">
              {busy ? "Kaydediliyor…" : "Eşleştirmeyi kaydet"}
            </Button>
            <Button type="button" variant="secondary" onClick={onDone} disabled={busy} className="w-full sm:w-auto">
              Vazgeç
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
