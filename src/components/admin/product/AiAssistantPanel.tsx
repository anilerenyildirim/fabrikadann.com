"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, FormNotice } from "@/components/ui/form";

type Attr = { id: number; name: string; valueId: number | null; customValue: string | null; label: string };
type Suggestion = {
  name: string;
  description: string;
  details: string;
  categoryId: string | null;
  colors: { colorId: string; name: string }[];
  n11Attributes: Attr[];
  notes: string[];
};
type Field = "name" | "description" | "details" | "categoryId" | "colors" | "n11Attributes";

export type AssistantCurrent = {
  name: string;
  description: string;
  details: string;
  categoryId: string | null;
  colors: { id: string; name: string }[];
  n11Attributes: { id: number; name: string; valueId: number | null; customValue: string | null }[];
};

/** Ürün sayfasında AI Asistan: fotoğraflardan öneri al, alan alan seç, uygula. */
export function AiAssistantPanel({
  productId,
  current,
  categories,
  enabled,
  hasImages,
  autoStart,
  suggest,
  apply,
}: {
  productId: string;
  current: AssistantCurrent;
  categories: { id: string; name: string }[];
  enabled: boolean;
  hasImages: boolean;
  autoStart: boolean;
  suggest: (id: string) => Promise<{ suggestion?: Suggestion; error?: string }>;
  apply: (id: string, input: unknown) => Promise<{ ok?: true; error?: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"suggest" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [s, setS] = useState<Suggestion | null>(null);
  const [picked, setPicked] = useState<Set<Field>>(new Set());
  const started = useRef(false);

  async function run() {
    setBusy("suggest");
    setError(null);
    setDone(null);
    const r = await suggest(productId).catch(() => ({ error: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin." }) as { error: string; suggestion?: Suggestion });
    setBusy(null);
    if (!r.suggestion) return setError(r.error ?? "Öneri alınamadı.");
    const sug = r.suggestion;
    setS(sug);
    const all: Field[] = ["name", "description", "details"];
    if (sug.categoryId) all.push("categoryId");
    if (sug.colors.length) all.push("colors");
    if (sug.n11Attributes.length) all.push("n11Attributes");
    setPicked(new Set(all));
  }

  useEffect(() => {
    if (autoStart && enabled && hasImages && !started.current) {
      started.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, enabled, hasImages]);

  async function applyPicked() {
    if (!s) return;
    setBusy("apply");
    setError(null);
    const input: Record<string, unknown> = {};
    if (picked.has("name")) input.name = s.name;
    if (picked.has("description")) input.description = s.description;
    if (picked.has("details")) input.details = s.details;
    if (picked.has("categoryId") && s.categoryId) input.categoryId = s.categoryId;
    if (picked.has("colors")) input.colors = s.colors;
    if (picked.has("n11Attributes")) input.n11Attributes = s.n11Attributes.map(({ id, name, valueId, customValue }) => ({ id, name, valueId, customValue }));
    const r = await apply(productId, input).catch(() => ({ error: "Sunucuya ulaşılamadı." }) as { error: string; ok?: true });
    setBusy(null);
    if (r.error) return setError(r.error);
    setS(null);
    setDone("Seçilen öneriler uygulandı. Kontrol edip ürünü yayına alabilirsiniz.");
    router.refresh();
  }

  const toggle = (f: Field, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(f);
      else next.delete(f);
      return next;
    });

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";
  const colorName = (id: string) => current.colors.find((c) => c.id === id)?.name ?? "";

  const rows: { field: Field; label: string; before: string; after: string }[] = s
    ? [
        { field: "name", label: "Ürün adı", before: current.name, after: s.name },
        { field: "description", label: "Açıklama", before: current.description, after: s.description },
        { field: "details", label: "Malzeme ve bakım", before: current.details, after: s.details },
        ...(s.categoryId ? [{ field: "categoryId" as Field, label: "Kategori", before: catName(current.categoryId), after: catName(s.categoryId) }] : []),
        ...(s.colors.length
          ? [{ field: "colors" as Field, label: "Renk adları", before: s.colors.map((c) => colorName(c.colorId)).join(", "), after: s.colors.map((c) => c.name).join(", ") }]
          : []),
        ...(s.n11Attributes.length
          ? [
              {
                field: "n11Attributes" as Field,
                label: "N11 özellikleri",
                before: current.n11Attributes.map((a) => `${a.name}: ${a.customValue ?? "seçili"}`).join(", ") || "—",
                after: s.n11Attributes.map((a) => `${a.name}: ${a.label}`).join(", "),
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      {!enabled && <FormNotice tone="info">AI Asistan kapalı: sunucuda ANTHROPIC_API_KEY tanımlayın.</FormNotice>}
      {enabled && !hasImages && <p className="text-[0.8125rem] text-graphite">Önce aşağıdan renk ve görsel ekleyin; asistan fotoğraflara bakarak öneri yapar.</p>}
      {error && <FormNotice>{error}</FormNotice>}
      {done && <FormNotice tone="info">{done}</FormNotice>}
      {enabled && hasImages && !s && (
        <div>
          <Button type="button" variant="secondary" onClick={run} disabled={busy !== null} className="w-full sm:w-auto">
            {busy === "suggest" ? "Fotoğraflar inceleniyor… (yarım dakika sürebilir)" : "Fotoğraflardan öner"}
          </Button>
        </div>
      )}
      {s && (
        <>
          <ul className="border-t border-ink">
            {rows.map((r) => (
              <li key={r.field} className="border-b border-rule py-3">
                <Checkbox
                  id={`ai-${r.field}`}
                  name={r.field}
                  checked={picked.has(r.field)}
                  onChange={(e) => toggle(r.field, e.currentTarget.checked)}
                  label={<span className="label">{r.label}</span>}
                />
                <div className="mt-1 grid gap-2 text-[0.8125rem] md:grid-cols-2">
                  <p className="whitespace-pre-line text-graphite [overflow-wrap:anywhere]">
                    <span className="label mr-1">Şu an</span>
                    {r.before || "—"}
                  </p>
                  <p className="whitespace-pre-line [overflow-wrap:anywhere]">
                    <span className="label mr-1">Öneri</span>
                    {r.after}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {s.notes.length > 0 && (
            <FormNotice tone="info">
              <span className="block font-medium">Kontrol edin</span>
              {s.notes.map((n) => (
                <span key={n} className="block">
                  {n}
                </span>
              ))}
            </FormNotice>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={applyPicked} disabled={busy !== null || picked.size === 0} className="w-full sm:w-auto">
              {busy === "apply" ? "Uygulanıyor…" : `Seçilenleri uygula (${picked.size})`}
            </Button>
            <Button type="button" variant="secondary" onClick={run} disabled={busy !== null} className="w-full sm:w-auto">
              {busy === "suggest" ? "İnceleniyor…" : "Yeniden öner"}
            </Button>
            <Button type="button" variant="quiet" onClick={() => setS(null)} disabled={busy !== null}>
              Vazgeç
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
