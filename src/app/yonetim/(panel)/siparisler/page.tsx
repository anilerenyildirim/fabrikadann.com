import type { Metadata } from "next";
import Link from "next/link";
import {
  Empty,
  FilterLinks,
  formatDateTime,
  OrderStatusTag,
  PageHeader,
  Pager,
  pageParam,
  param,
  qs,
  SearchForm,
  table,
  TableWrap,
  td,
  th,
} from "@/components/admin/ui";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { listAdminOrders, ORDER_STATUS_LABELS, ORDER_STATUSES } from "@/server/services/admin/orders";
import { releaseExpiredOrders, type OrderStatus } from "@/server/services/orders";

export const metadata: Metadata = { title: "Siparişler" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = param(sp.q);
  const durum = param(sp.durum);
  const status = (ORDER_STATUSES as readonly string[]).includes(durum ?? "") ? (durum as OrderStatus) : "all";
  const page = pageParam(sp.sayfa);
  await releaseExpiredOrders();
  const result = await listAdminOrders({ status, q, page });
  const href = (p: number) => qs("/yonetim/siparisler", { q, durum: status === "all" ? undefined : status, sayfa: p > 1 ? p : undefined });

  return (
    <>
      <PageHeader title="Siparişler" description="Kargolanacak siparişler “Hazırlanıyor” durumundadır." />
      <SearchForm
        action="/yonetim/siparisler"
        q={q}
        label="Sipariş numarası ya da e-posta"
        placeholder="FD… ya da ornek@eposta.com"
        hidden={{ durum: status === "all" ? undefined : status }}
      />
      <FilterLinks
        label="Durum"
        current={status}
        items={[
          { value: "all", label: "Hepsi", href: qs("/yonetim/siparisler", { q }) },
          ...ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s], href: qs("/yonetim/siparisler", { q, durum: s }) })),
        ]}
      />

      {result.items.length === 0 ? (
        <Empty>{q || status !== "all" ? "Bu süzgece uyan sipariş yok." : "Henüz sipariş yok."}</Empty>
      ) : (
        <TableWrap label="Sipariş listesi">
          <table className={`${table} min-w-[720px]`}>
            <thead>
              <tr>
                <th className={th}>Sipariş</th>
                <th className={th}>Tarih</th>
                <th className={th}>Müşteri</th>
                <th className={`${th} text-right`}>Adet</th>
                <th className={`${th} text-right`}>Tutar</th>
                <th className={th}>Durum</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((o) => (
                <tr key={o.id} className="hover:bg-fog">
                  <td className={td}>
                    <Link href={`/yonetim/siparisler/${o.id}`} className="tabular inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                      {o.number}
                    </Link>
                  </td>
                  <td className={`${td} whitespace-nowrap text-graphite`}>{formatDateTime(o.createdAt)}</td>
                  <td className={`${td} max-w-64`}>
                    <span className="block truncate">{o.fullName}</span>
                    <span className="block truncate text-[0.75rem] text-graphite">
                      {o.email}
                      {o.isGuest ? " · misafir" : ""}
                    </span>
                  </td>
                  <td className={`${td} tabular text-right`}>{o.itemCount}</td>
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
      <Pager page={result.page} pageCount={result.pageCount} total={result.total} unit="sipariş" hrefFor={href} />
    </>
  );
}
