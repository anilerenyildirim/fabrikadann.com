import type { Metadata } from "next";
import Link from "next/link";
import {
  Empty,
  formatDate,
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
import { listCustomers } from "@/server/services/admin/customers";

export const metadata: Metadata = { title: "Müşteriler" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = param(sp.q);
  const page = pageParam(sp.sayfa);
  const result = await listCustomers({ q, page });

  return (
    <>
      <PageHeader
        title="Müşteriler"
        description="Kayıtlı müşteriler (salt okunur). Misafir siparişler Siparişler sayfasında e-postayla aranabilir. Harcama, ödenmiş ve iptal/iade edilmemiş siparişleri sayar."
      />
      <SearchForm action="/yonetim/musteriler" q={q} placeholder="Ad, soyad ya da e-posta" />
      {result.items.length === 0 ? (
        <Empty>{q ? "Bu aramaya uyan müşteri yok." : "Henüz kayıtlı müşteri yok."}</Empty>
      ) : (
        <TableWrap label="Müşteri listesi">
          <table className={`${table} min-w-[680px]`}>
            <thead>
              <tr>
                <th className={th}>Ad soyad</th>
                <th className={th}>E-posta</th>
                <th className={th}>Kayıt</th>
                <th className={`${th} text-right`}>Sipariş</th>
                <th className={`${th} text-right`}>Toplam harcama</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((c) => (
                <tr key={c.id}>
                  <td className={`${td} max-w-56 truncate`}>
                    {c.firstName} {c.lastName}
                  </td>
                  <td className={`${td} max-w-64`}>
                    <Link
                      href={qs("/yonetim/siparisler", { q: c.email })}
                      className="inline-flex min-h-11 max-w-full items-center underline-offset-4 hover:underline"
                      title="Siparişlerini gör"
                    >
                      <span className="truncate">{c.email}</span>
                    </Link>
                  </td>
                  <td className={`${td} whitespace-nowrap text-graphite`}>{formatDate(c.createdAt)}</td>
                  <td className={`${td} tabular text-right`}>{c.orderCount}</td>
                  <td className={`${td} tabular text-right whitespace-nowrap`}>{formatPrice(c.totalSpent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Pager
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        unit="müşteri"
        hrefFor={(p) => qs("/yonetim/musteriler", { q, sayfa: p > 1 ? p : undefined })}
      />
    </>
  );
}
