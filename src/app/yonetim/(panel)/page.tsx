import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/admin/forms";
import { trendyolProblems } from "@/components/admin/TrendyolPanel";
import { ErrorMark } from "@/components/ui/form";
import {
  Empty,
  formatDateTime,
  OrderStatusTag,
  PageHeader,
  Section,
  Stat,
  table,
  TableWrap,
  td,
  th,
} from "@/components/admin/ui";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { getDashboard } from "@/server/services/admin/dashboard";
import { getTrendyolStatus } from "@/server/services/trendyol";
import { resolveRefundAction } from "./actions";

export const metadata: Metadata = { title: "Pano" };

const dayLabel = new Intl.DateTimeFormat("tr-TR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export default async function DashboardPage() {
  const admin = await requireAdmin();
  const [d, trendyol] = await Promise.all([getDashboard(), getTrendyolStatus()]);
  const trendyolIssues = trendyolProblems(trendyol);
  const maxDay = Math.max(1, ...d.week.map((w) => w.total));

  return (
    <>
      <PageHeader title="Pano" description={`Merhaba ${admin.firstName}. Bugün yapılacaklar ve son durum.`} />

      <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 md:gap-x-8">
        <Stat
          label="Kargolanacak"
          value={d.toShip}
          hint="Hazırlanıyor durumunda"
          href="/yonetim/siparisler?durum=preparing"
        />
        <Stat
          label="Ödeme bekleyen"
          value={d.awaitingPayment}
          hint="30 dakika içinde ödenmezse iptal olur"
          href="/yonetim/siparisler?durum=awaiting_payment"
        />
        <Stat label="Bugünkü ciro" value={formatPrice(d.today.total)} hint={`${d.today.count} sipariş · iptal/iade hariç`} />
        <Stat label="Son 7 gün" value={formatPrice(d.weekTotal)} hint={`${d.weekCount} sipariş`} />
      </div>

      {d.refunds.length > 0 && (
        <Section
          title={`İade gereken ödemeler (${d.refunds.length})`}
          description="Bu siparişlerin parası alındı ama sipariş karşılanamadı ya da iptal/iade edildi. Tutarı ödeme sağlayıcısının panelinden iade edin, sonra burada işaretleyin."
        >
          <ul className="divide-y divide-rule border-y border-ink">
            {d.refunds.map((r) => (
              <li key={r.auditId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  {r.orderId ? (
                    <Link href={`/yonetim/siparisler/${r.orderId}`} className="tabular inline-flex min-h-11 items-center underline underline-offset-4">
                      {r.orderNumber}
                    </Link>
                  ) : (
                    <span className="tabular">{r.orderNumber ?? "—"}</span>
                  )}
                  <span className="ml-3 text-[0.8125rem] text-graphite">{formatDateTime(r.createdAt)}</span>
                  <p className="text-[0.8125rem] text-graphite">{r.reason}</p>
                </div>
                <ActionButton
                  action={resolveRefundAction}
                  fields={{ auditId: r.auditId }}
                  label="İade ettim"
                  pendingLabel="Kaydediliyor…"
                  confirm={`${r.orderNumber ?? "Bu"} siparişinin parasını ödeme sağlayıcısı panelinden iade ettiniz mi?`}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {trendyolIssues.length > 0 && (
        <Section
          title="Trendyol senkronu"
          actions={
            <Link href="/yonetim/stok#trendyol" className="label inline-flex min-h-11 items-center underline-offset-4 hover:underline">
              Ayrıntılar
            </Link>
          }
        >
          <ul className="border-t border-ink">
            {trendyolIssues.map((p) => (
              <li key={p} className="flex items-start gap-2 border-b border-ink py-2.5 text-[0.8125rem] font-medium">
                <ErrorMark />
                <span className="min-w-0 break-words">{p}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="mt-10 grid grid-cols-1 gap-x-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section
          title="Son siparişler"
          actions={
            <Link href="/yonetim/siparisler" className="label inline-flex min-h-11 items-center underline-offset-4 hover:underline">
              Tümü
            </Link>
          }
        >
          {d.recent.length === 0 ? (
            <Empty>Henüz sipariş yok.</Empty>
          ) : (
            <TableWrap label="Son siparişler">
              <table className={`${table} min-w-[560px]`}>
                <thead>
                  <tr>
                    <th className={th}>Sipariş</th>
                    <th className={th}>Müşteri</th>
                    <th className={th}>Tarih</th>
                    <th className={`${th} text-right`}>Tutar</th>
                    <th className={th}>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((o) => (
                    <tr key={o.id}>
                      <td className={td}>
                        <Link href={`/yonetim/siparisler/${o.id}`} className="tabular inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                          {o.number}
                        </Link>
                      </td>
                      <td className={`${td} max-w-48 truncate`}>{o.fullName}</td>
                      <td className={`${td} whitespace-nowrap text-graphite`}>{formatDateTime(o.createdAt)}</td>
                      <td className={`${td} tabular text-right whitespace-nowrap`}>{formatPrice(o.total)}</td>
                      <td className={td}>
                        <OrderStatusTag status={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Section>

        <div>
          <Section title="Son 7 günün cirosu" description="Ödenen ve iptal/iade edilmeyen siparişler, İstanbul saatiyle.">
            <table className={table}>
              <caption className="sr-only">Günlük ciro</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Gün</th>
                  <th scope="col" className="hidden sm:table-cell">
                    Oran
                  </th>
                  <th scope="col">Sipariş</th>
                  <th scope="col">Ciro</th>
                </tr>
              </thead>
              <tbody>
                {[...d.week].reverse().map((w) => (
                  <tr key={w.day}>
                    <td className={`${td} w-28 whitespace-nowrap`}>{dayLabel.format(new Date(`${w.day}T00:00:00Z`))}</td>
                    <td className={`${td} hidden sm:table-cell`} aria-hidden="true">
                      <div className="h-1.5 bg-fog">
                        <div className="h-full bg-ink" style={{ width: `${Math.round((w.total / maxDay) * 100)}%` }} />
                      </div>
                    </td>
                    <td className={`${td} tabular w-12 text-right text-graphite`}>{w.count}</td>
                    <td className={`${td} tabular w-32 text-right whitespace-nowrap`}>{formatPrice(w.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            title="Az kalan stok"
            description="Stoğu 2 ve altındaki numaralar (arşivdeki ürünler hariç)."
            actions={
              <Link href="/yonetim/stok?filtre=low" className="label inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                Stok
              </Link>
            }
          >
            {d.lowStock.length === 0 ? (
              <Empty>Az kalan numara yok.</Empty>
            ) : (
              <ul className="divide-y divide-rule border-t border-ink">
                {d.lowStock.map((v) => (
                  <li key={v.variantId}>
                    <Link
                      href={`/yonetim/urunler/${v.productId}#numaralar`}
                      className="flex min-h-11 items-center justify-between gap-3 py-2 hover:bg-fog"
                    >
                      <span className="min-w-0 truncate">
                        {v.productName} <span className="text-graphite">· {v.colorName} · {v.size}</span>
                      </span>
                      <span className={`tabular shrink-0 ${v.stock === 0 ? "label bg-ink px-2 py-0.5 text-paper" : ""}`}>
                        {v.stock === 0 ? "Tükendi" : `${v.stock} adet`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
