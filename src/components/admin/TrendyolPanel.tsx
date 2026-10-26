import Link from "next/link";
import type { ReactNode } from "react";
import { ErrorMark } from "@/components/ui/form";
import { formatPrice } from "@/lib/money";
import type { TrendyolStatus } from "@/server/services/trendyol";
import { ActionButton, type FormAction } from "./forms";
import { formatDateTime, Section } from "./ui";

// Zamanlanmış görev bu süredir çalışmadıysa uyarı
const STALE_MS = 15 * 60_000;

/** Senkronun dikkat isteyen durumları (pano ve stok sayfası için). */
export function trendyolProblems(s: TrendyolStatus, now = Date.now()): string[] {
  const problems: string[] = [];
  if (s.configError) problems.push(`Ayarlar hatalı: ${s.configError}`);
  if (!s.configured) return problems;
  const lastRun = s.state.lastRunAt ? Date.parse(s.state.lastRunAt) : null;
  if (!lastRun) problems.push("Senkron henüz hiç çalışmadı. Zamanlanmış görevi kurun (npm run trendyol:sync).");
  else if (now - lastRun > STALE_MS) problems.push(`Senkron ${formatDateTime(new Date(lastRun))} tarihinden beri çalışmadı. Zamanlanmış görevi kontrol edin.`);
  if (s.state.lastError) problems.push(`Son çalıştırmada hata: ${s.state.lastError}`);
  const summary = s.state.lastSummary;
  if (summary?.windowClipped) {
    problems.push("Senkron 13 günden uzun süre çalışmadı; aradaki Trendyol değişiklikleri alınamadı. Stokları depo sayımıyla kontrol edin.");
  }
  if (summary?.skippedPackages) problems.push(`Son çalıştırmada ${summary.skippedPackages} Trendyol paketi okunamadı ve işlenmedi.`);
  if (summary?.priceError) problems.push(`Trendyol fiyatları okunamadı: ${summary.priceError}`);
  if (s.state.lastSuccessAt && (!s.state.lastPriceSyncAt || now - s.state.lastPriceSyncAt > 3 * 3600_000)) {
    problems.push("Trendyol fiyatları 3 saattir güncellenemedi; vitrindeki karşılaştırma fiyatları eski olabilir.");
  }
  if (s.state.priceWarnings?.length) {
    problems.push(`${s.state.priceWarnings.length} ürün Trendyol'da sitedekinden ucuz ya da aynı fiyatta; vitrinde karşılaştırma gösterilmiyor.`);
  }
  if (s.shortfalls.length) problems.push(`${s.shortfalls.length} Trendyol siparişi için stok yoktu (aynı çift iki kanalda satılmış olabilir).`);
  if (s.unmatched.length) problems.push(`${s.unmatched.length} Trendyol kalemi hiçbir numarayla eşleşmedi (barkod eksik).`);
  if (s.failedPushes.length) problems.push(`${s.failedPushes.length} numaranın stoğu Trendyol'a gönderilemedi.`);
  return problems;
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 border-b border-ink py-2.5 text-[0.8125rem] font-medium">
      <ErrorMark />
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

function List({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className="label mb-2 text-graphite">{title}</h3>
      <ul className="divide-y divide-rule border-y border-rule text-[0.8125rem]">{children}</ul>
    </div>
  );
}

export function TrendyolPanel({ status: s, syncAction }: { status: TrendyolStatus; syncAction?: FormAction }) {
  const problems = trendyolProblems(s);
  if (!s.configured && !s.configError) {
    return (
      <Section id="trendyol" title="Trendyol senkronu" description="Kapalı.">
        <p className="max-w-2xl text-[0.8125rem] text-graphite">
          Trendyol API bilgileri tanımlanınca Trendyol siparişleri buradaki stoktan düşülür, iptaller geri konur ve barkodu olan
          her numaranın stoğu Trendyol'a gönderilir. Kurulum: canlıya alma belgesi, “Trendyol ortak stok” bölümü.
        </p>
      </Section>
    );
  }
  const summary = s.state.lastSummary;
  return (
    <Section
      id="trendyol"
      title="Trendyol senkronu"
      actions={
        syncAction && s.configured ? (
          <ActionButton action={syncAction} fields={{}} label="Şimdi senkronize et" pendingLabel="Çalışıyor…" />
        ) : undefined
      }
      description={
        <>
          Barkodu olan numaralar Trendyol ile eşleşir. Son başarılı çalıştırma:{" "}
          <span className="tabular">{s.state.lastSuccessAt ? formatDateTime(s.state.lastSuccessAt) : "—"}</span>
          {summary && (
            <>
              {" "}
              · son çalıştırmada {summary.packages} paket, {summary.deducted} adet düşüldü, {summary.returned} adet geri kondu,{" "}
              {summary.pushed} numara gönderildi
            </>
          )}
          {s.pendingPushes > 0 && <> · Trendyol'un onayını bekleyen {s.pendingPushes} numara</>}
        </>
      }
    >
      {problems.length === 0 ? (
        <p className="text-[0.8125rem] text-graphite">Sorun yok.</p>
      ) : (
        <ul className="border-t border-ink">
          {problems.map((p) => (
            <Problem key={p}>{p}</Problem>
          ))}
        </ul>
      )}

      {s.shortfalls.length > 0 && (
        <List title="Stok yetmeyen Trendyol siparişleri">
          {s.shortfalls.map((r) => (
            <li key={`${r.orderNumber}-${r.barcode}`} className="py-2.5">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="tabular">Trendyol {r.orderNumber}</span>
                <Link href={`/yonetim/urunler/${r.productId}#numaralar`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                  {r.productName}
                </Link>
                <span className="text-graphite">
                  {r.colorName} · {r.size} · {r.shortfall} adet eksik
                </span>
              </div>
              <p className="text-graphite">
                Siparişlerden birini iptal edin ya da stok ekleyin; stok gelince eksik adet otomatik düşülür.
              </p>
            </li>
          ))}
        </List>
      )}

      {!!s.state.priceWarnings?.length && (
        <List title="Trendyol'da daha ucuz ya da aynı fiyatta">
          {s.state.priceWarnings.map((w) => (
            <li key={w.productId} className="py-2.5">
              <div className="flex flex-wrap items-center gap-x-2">
                <Link href={`/yonetim/urunler/${w.productId}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                  {w.name}
                </Link>
                <span className="tabular text-graphite">
                  site {formatPrice(w.price)} · Trendyol {formatPrice(w.trendyolPrice)}
                </span>
              </div>
            </li>
          ))}
        </List>
      )}

      {s.unmatched.length > 0 && (
        <List title="Eşleşmeyen barkodlar">
          {s.unmatched.map((r) => (
            <li key={`${r.orderNumber}-${r.barcode}`} className="py-2.5">
              <span className="tabular">{r.barcode}</span>{" "}
              <span className="text-graphite">
                · Trendyol {r.orderNumber} · {r.quantity} adet. Bu barkodu ilgili numaraya yazın; sonraki senkronda stoktan düşülür.
              </span>
            </li>
          ))}
        </List>
      )}

      {s.failedPushes.length > 0 && (
        <List title="Trendyol'a gönderilemeyen stoklar">
          {s.failedPushes.map((r) => (
            <li key={r.barcode} className="py-2.5">
              <div className="flex flex-wrap items-center gap-x-2">
                {r.productId ? (
                  <Link href={`/yonetim/urunler/${r.productId}#numaralar`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                    {r.productName}
                  </Link>
                ) : (
                  <span className="inline-flex min-h-11 items-center">Hiçbir numarada olmayan barkod (Trendyol'a 0 gönderiliyor)</span>
                )}
                <span className="text-graphite">
                  {r.productId && (
                    <>
                      {r.colorName} · {r.size} ·{" "}
                    </>
                  )}
                  <span className="tabular">{r.barcode}</span>
                </span>
              </div>
              <p className="break-words text-graphite">
                {r.error ?? "Bilinmeyen hata"} · {formatDateTime(r.pushedAt)}. 15 dakika sonra yeniden denenir.
              </p>
            </li>
          ))}
        </List>
      )}
    </Section>
  );
}
