"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, Checkbox, ErrorMark, FormNotice } from "@/components/ui/form";
import { formatPrice } from "@/lib/money";

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
  misplacedItems: number;
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
  moved: string[];
  problems: { barcode: string; reason: string }[];
  imageErrors: number;
  message?: string;
};

type Action = (mainId: string) => Promise<{ result?: ResultView; error?: string }>;

type Progress = { done: number; total: number; current: string; startedAt: number };

const STATUS_LABEL: Record<ResultView["status"], string> = {
  created: "Taslak oluşturuldu",
  updated: "Mevcut ürün güncellendi",
  skipped: "Atlandı",
  failed: "Aktarılamadı",
};

export function TrendyolImportForm({ action, candidates }: { action: Action; candidates: ImportCandidateView[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [results, setResults] = useState<ResultView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const running = progress !== null;

  // Aktarım sürerken sayfadan çıkılırsa yarıda kalır; tarayıcı uyarsın
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const tooMany = selected.size > MAX_SELECTED;

  async function run() {
    const queue = candidates.filter((c) => selected.has(c.productMainId));
    if (queue.length === 0 || queue.length > MAX_SELECTED) return;
    setError(null);
    setResults([]);
    const collected: ResultView[] = [];
    for (const [i, c] of queue.entries()) {
      setProgress({ done: i, total: queue.length, current: c.name, startedAt: Date.now() });
      let res: Awaited<ReturnType<Action>>;
      try {
        res = await action(c.productMainId);
      } catch {
        res = { error: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip kalan ürünleri yeniden seçin." };
      }
      if (res.result) collected.push(res.result);
      else collected.push({ productMainId: c.productMainId, name: c.name, status: "failed", added: [], moved: [], problems: [], imageErrors: 0, message: res.error });
      setResults([...collected]);
      // Bağlantı ya da sınır hatasında kalanlar denenmez
      if (!res.result && res.error && /ulaşılamadı|Çok sık/.test(res.error)) {
        setError(res.error);
        break;
      }
    }
    setProgress(null);
    setSelected(new Set());
    startTransition(() => router.refresh());
  }

  const done = results.filter((r) => r.status === "created" || r.status === "updated").length;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!running) void run();
      }}
      className="flex flex-col gap-6"
    >
      {error && <FormNotice>{error}</FormNotice>}
      {!running && results.length > 0 && (
        <FormNotice tone={done > 0 ? "info" : "error"}>
          {done > 0 ? `${done} ürün aktarıldı. Taslakları kontrol edip yayına alın.` : "Hiçbir ürün aktarılmadı; ayrıntılar aşağıda."}
        </FormNotice>
      )}
      {progress && <ImportProgress progress={progress} />}
      {results.length > 0 && <Results results={results} />}

      <ul className="border-t border-ink">
        {candidates.map((c) => {
          const importable = c.newItems > 0 || c.misplacedItems > 0;
          return (
            <li key={c.productMainId} className={`border-b border-rule px-3 py-3 ${importable ? "bg-caution/5" : ""}`}>
              <div className="flex items-start gap-3">
                <Checkbox
                  id={`aktar-${c.productMainId}`}
                  name="mainId"
                  value={c.productMainId}
                  disabled={!importable || running}
                  checked={selected.has(c.productMainId)}
                  onChange={(e) => toggle(c.productMainId, e.currentTarget.checked)}
                  label={<span className="sr-only">{c.name}</span>}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1 py-2 text-[0.8125rem]">
                  <p className="flex items-start gap-1.5 font-medium [overflow-wrap:anywhere]">
                    {importable && (
                      <>
                        <ErrorMark />
                        <span className="sr-only">Sitede eksik: </span>
                      </>
                    )}
                    <span className="min-w-0">{c.name}</span>
                  </p>
                  <p className="mt-1 text-graphite [overflow-wrap:anywhere]">
                    {c.categoryName ?? "Kategorisiz"} · {c.colorNames.length} renk: {c.colorNames.join(", ") || "renk yok"} · {c.sizes.length} numara
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
                    {c.newItems > 0 && (
                      <>
                        {c.newItems} yeni numara, toplam <span className="tabular">{c.newStock}</span> adet stok
                        {c.existingItems > 0 && <> · {c.existingItems} numara zaten sitede</>}
                      </>
                    )}
                    {!importable && <span className="label">Tümü sitede</span>}
                    {c.siteProduct && (
                      <>
                        {" · "}
                        <Link href={`/yonetim/urunler/${c.siteProduct.id}`} className="inline-flex min-h-11 items-center text-ink underline underline-offset-4">
                          Sitedeki ürün: {c.siteProduct.name}
                        </Link>
                      </>
                    )}
                  </p>
                  {c.misplacedItems > 0 && (
                    <p className="mt-1 font-medium">
                      Sitede {c.misplacedItems} numara Trendyol'dakinden farklı renkte. Aktarınca Trendyol'daki renklere ayrılır.
                    </p>
                  )}
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

      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-ink bg-paper py-3">
        {progress && <ImportProgress progress={progress} compact />}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={running || selected.size === 0 || tooMany} className="w-full sm:w-auto">
            {progress ? `Aktarılıyor… ${progress.done + 1} / ${progress.total}` : `Seçilenleri taslak olarak aktar (${selected.size})`}
          </Button>
          {tooMany && <p className="text-[0.8125rem]">Tek seferde en fazla {MAX_SELECTED} ürün aktarılabilir.</p>}
        </div>
      </div>
    </form>
  );
}

/** Ürün ürün ilerleme: biten ürünler dolu, sıradaki ürünün payı hareketli çizgiyle; geçen süre saniye saniye. */
function ImportProgress({ progress, compact = false }: { progress: Progress; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.floor((now - progress.startedAt) / 1000));
  const share = 100 / progress.total;
  return (
    <div className={compact ? "" : "border border-ink p-4"} aria-live="polite">
      {!compact && (
        <p className="mb-3 text-[0.8125rem] [overflow-wrap:anywhere]">
          <span className="label mr-2">
            Ürün {progress.done + 1} / {progress.total}
          </span>
          {progress.current} — Trendyol'dan okunuyor, görseller indirilip işleniyor
          <span className="tabular text-graphite"> ({seconds} sn)</span>
        </p>
      )}
      <div
        role="progressbar"
        aria-label="Aktarım ilerlemesi"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
        aria-valuetext={`${progress.done} / ${progress.total} ürün aktarıldı`}
        className="relative h-2 w-full overflow-hidden bg-fog"
      >
        <div className="absolute inset-y-0 left-0 bg-ink transition-[width] duration-300" style={{ width: `${progress.done * share}%` }} />
        <div className="absolute inset-y-0 overflow-hidden" style={{ left: `${progress.done * share}%`, width: `${share}%` }}>
          <div className="ilerleme-akis absolute inset-y-0 w-1/3 bg-graphite" />
        </div>
      </div>
      {!compact && (
        <p className="mt-2 text-[0.8125rem] text-graphite">
          Görseli çok olan ürün bir dakikaya kadar sürebilir. Bu sayfadan çıkmayın; biten ürünler aşağıda listelenir.
        </p>
      )}
    </div>
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
            {r.moved.length > 0 && <p className="text-graphite">Doğru renge taşınan numaralar: {r.moved.join(", ")}</p>}
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
