"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, Checkbox, ErrorMark, FormNotice } from "@/components/ui/form";

const MAX_SELECTED = 8;

export type N11ProductView = {
  id: string;
  name: string;
  status: string;
  categoryName: string | null;
  mapped: boolean;
  total: number;
  pending: number;
  active: number;
  failed: number;
  sendable: number;
  errors: string[];
};

type Result = { id: string; name: string; ok: boolean; message: string; problems: string[] };
type Action = (id: string) => Promise<{
  result?: { status: "sent" | "nothing" | "failed"; sent: number; problems: { stockCode: string | null; reason: string }[]; message?: string };
  error?: string;
}>;

function stateText(p: N11ProductView): string {
  if (p.status !== "active") return "Yayında değil";
  if (!p.mapped) return "Kategorisi N11'e eşlenmemiş";
  if (p.total === 0) return "Numarası yok";
  const parts = [];
  if (p.active) parts.push(`${p.active} numara N11'de`);
  if (p.pending) parts.push(`${p.pending} numara N11'in onayını bekliyor`);
  if (p.failed) parts.push(`${p.failed} numara reddedildi`);
  const fresh = p.total - p.active - p.pending - p.failed;
  if (fresh > 0) parts.push(`${fresh} numara gönderilmedi`);
  return parts.join(" · ");
}

export function N11SendForm({ products, action, blocked }: { products: N11ProductView[]; action: Action; blocked: string | null }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [, startTransition] = useTransition();
  const running = progress !== null;

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
    const queue = products.filter((p) => selected.has(p.id));
    if (queue.length === 0 || tooMany) return;
    const collected: Result[] = [];
    setResults([]);
    for (const [i, p] of queue.entries()) {
      setProgress({ done: i, total: queue.length, current: p.name });
      let res: Awaited<ReturnType<Action>>;
      try {
        res = await action(p.id);
      } catch {
        res = { error: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip kalanları yeniden seçin." };
      }
      const r = res.result;
      collected.push({
        id: p.id,
        name: p.name,
        ok: r?.status === "sent",
        message: res.error ?? (r?.status === "sent" ? `${r.sent} numara gönderildi; N11'in onayı birkaç dakika sürer.` : r?.status === "nothing" ? "Gönderilecek yeni numara yok." : (r?.message ?? "Gönderilemedi.")),
        problems: (r?.problems ?? []).map((x) => (x.stockCode ? `${x.stockCode}: ${x.reason}` : x.reason)),
      });
      setResults([...collected]);
      if (res.error && /ulaşılamadı|Çok sık|bağlantısı tanımlı/.test(res.error)) break;
    }
    setProgress(null);
    setSelected(new Set());
    startTransition(() => router.refresh());
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!running) void run();
      }}
      className="flex flex-col gap-6"
    >
      {blocked && <FormNotice>{blocked}</FormNotice>}
      {results.length > 0 && (
        <ul className="flex flex-col gap-2 border border-rule p-4 text-[0.8125rem]" aria-live="polite">
          {results.map((r) => (
            <li key={r.id} className="[overflow-wrap:anywhere]">
              <span className="font-medium">{r.name}:</span> {r.message}
              {r.problems.map((p) => (
                <span key={p} className="block text-graphite">
                  {p}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}

      <ul className="border-t border-ink">
        {products.map((p) => {
          const needs = p.sendable > 0 || p.failed > 0 || !p.mapped;
          return (
            <li key={p.id} className={`border-b border-rule px-3 py-3 ${needs && p.status === "active" ? "bg-caution/5" : ""}`}>
              <div className="flex items-start gap-3">
                <Checkbox
                  id={`n11-${p.id}`}
                  name="productId"
                  value={p.id}
                  disabled={p.sendable === 0 || running || !!blocked}
                  checked={selected.has(p.id)}
                  onChange={(e) => toggle(p.id, e.currentTarget.checked)}
                  label={<span className="sr-only">{p.name}</span>}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1 py-2 text-[0.8125rem]">
                  <p className="flex items-start gap-1.5 font-medium [overflow-wrap:anywhere]">
                    {needs && p.status === "active" && <ErrorMark />}
                    <Link href={`/yonetim/urunler/${p.id}`} className="min-w-0 underline-offset-4 hover:underline">
                      {p.name}
                    </Link>
                  </p>
                  <p className="mt-1 text-graphite">
                    {p.categoryName ?? "Kategorisiz"} · {p.total} numara · {stateText(p)}
                  </p>
                  {!p.mapped && p.status === "active" && (
                    <p className="mt-1">
                      <Link href="/yonetim/kategoriler/n11" className="inline-flex min-h-11 items-center underline underline-offset-4">
                        Kategoriyi N11'e eşleştir
                      </Link>
                    </p>
                  )}
                  {p.errors.map((e) => (
                    <p key={e} className="mt-1 [overflow-wrap:anywhere]">
                      N11: {e}
                    </p>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-ink bg-paper py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={running || selected.size === 0 || tooMany || !!blocked} className="w-full sm:w-auto">
            {progress ? `Gönderiliyor… ${progress.done + 1} / ${progress.total}` : `Seçilenleri N11'e gönder (${selected.size})`}
          </Button>
          {tooMany && <p className="text-[0.8125rem]">Tek seferde en fazla {MAX_SELECTED} ürün gönderilebilir.</p>}
        </div>
      </div>
    </form>
  );
}
