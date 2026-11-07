import Link from "next/link";
import { formatDateTime, Section } from "./ui";
import type { getN11Status } from "@/server/services/marketplace-sync";

type N11Status = Awaited<ReturnType<typeof getN11Status>>;

/** Stok sayfasında N11 senkron durumu. */
export function N11Panel({ status: s }: { status: N11Status }) {
  if (!s.configured && !s.configError) {
    return (
      <Section id="n11" title="N11 senkronu" description="Kapalı.">
        <p className="max-w-2xl text-[0.8125rem] text-graphite">
          N11 API bilgileri tanımlanınca N11 siparişleri buradaki stoktan düşülür, iptaller geri konur, yeni siparişler N11'de onaylanır ve
          N11'deki numaraların stoğu ile fiyatı N11'e gönderilir. Kurulum: canlıya alma belgesi, “N11” bölümü.
        </p>
      </Section>
    );
  }
  const summary = s.state.lastSummary;
  const problems: string[] = [];
  if (s.configError) problems.push(s.configError);
  if (s.state.lastError) problems.push(`Son çalıştırmada hata: ${s.state.lastError}`);
  if (s.listings.failed) problems.push(`N11'in reddettiği ${s.listings.failed} numara var; nedenleri Ürünler > N11'e gönder sayfasında.`);
  return (
    <Section
      id="n11"
      title="N11 senkronu"
      description={
        <>
          N11'de {s.listings.active} numara satışta
          {s.listings.pending > 0 && <>, {s.listings.pending} numara N11'in onayını bekliyor</>}. Son başarılı çalıştırma:{" "}
          <span className="tabular">{s.state.lastSuccessAt ? formatDateTime(s.state.lastSuccessAt) : "—"}</span>
          {summary && (
            <>
              {" "}
              · son çalıştırmada {summary.packages} paket, {summary.deducted} adet düşüldü, {summary.returned} adet geri kondu, {summary.approved} satır
              onaylandı, {summary.pushed} numara gönderildi
            </>
          )}
        </>
      }
    >
      {problems.length === 0 && s.shortfalls.length === 0 && s.unmatched.length === 0 ? (
        <p className="text-[0.8125rem] text-graphite">Sorun yok.</p>
      ) : (
        <ul className="flex flex-col gap-3 border-t border-ink pt-3 text-[0.8125rem]">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
          {s.shortfalls.map((r) => (
            <li key={`${r.orderNumber}-${r.stockCode}`}>
              N11 {r.orderNumber}:{" "}
              <Link href={`/yonetim/urunler/${r.productId}#numaralar`} className="underline underline-offset-4">
                {r.productName}
              </Link>{" "}
              {r.colorName} · {r.size} · {r.shortfall} adet eksik. Sipariş N11'de onaylanmadı; stok ekleyin ya da N11 panelinden iptal edin.
            </li>
          ))}
          {s.unmatched.map((r) => (
            <li key={`${r.orderNumber}-${r.stockCode}`}>
              N11 {r.orderNumber}: {r.stockCode} stok kodu hiçbir numarayla eşleşmiyor ({r.quantity} adet). N11'deki stok kodu sitedeki SKU ile aynı olmalı.
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
