import type { Metadata } from "next";
import Link from "next/link";
import { Empty, formatDate, PageHeader, pageParam, Pager, param, qs, table, TableWrap, td, th } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/form";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { listPurchases, PURCHASE_KIND_LABELS, purchaseRef } from "@/server/services/admin/purchases";

export const metadata: Metadata = { title: "Alış ve iade fişleri" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PurchasesPage({ searchParams }: Props) {
  await requireAdmin();
  const sp = await searchParams;
  const manufacturerId = param(sp.uretici, 60);
  const { rows, total, page, pageCount } = await listPurchases({ manufacturerId, page: pageParam(sp.sayfa) });
  return (
    <>
      <PageHeader
        title="Alış ve iade fişleri"
        back={{ href: "/yonetim/muhasebe", label: "Muhasebe" }}
        description="Üreticiden gelen mal (stok artar, borç yazılır) ve üreticiye iade (stok düşer, borç azalır)."
        actions={
          <ButtonLink href="/yonetim/muhasebe/fisler/yeni" className="min-h-11 px-4">
            Mal alımı gir
          </ButtonLink>
        }
      />
      {rows.length === 0 ? (
        <Empty>Henüz fiş yok.</Empty>
      ) : (
        <TableWrap label="Fiş listesi">
          <table className={`${table} min-w-[680px]`}>
            <thead>
              <tr>
                <th className={th}>Fiş</th>
                <th className={th}>Tarih</th>
                <th className={th}>Üretici</th>
                <th className={`${th} text-right`}>Çift</th>
                <th className={`${th} text-right`}>Tutar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-fog">
                  <td className={td}>
                    <Link href={`/yonetim/muhasebe/fisler/${r.id}`} className="inline-flex min-h-11 flex-col justify-center underline-offset-4 hover:underline">
                      <span className="tabular">{purchaseRef(r.number, r.kind)}</span>
                      <span className="text-[0.75rem] text-graphite">{PURCHASE_KIND_LABELS[r.kind]}</span>
                    </Link>
                  </td>
                  <td className={`${td} tabular whitespace-nowrap`}>{formatDate(`${r.date}T12:00:00Z`)}</td>
                  <td className={td}>
                    <Link href={`/yonetim/ureticiler/${r.manufacturerId}`} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                      {r.manufacturerName}
                    </Link>
                  </td>
                  <td className={`${td} tabular text-right`}>{r.kind === "return" ? `−${r.pairs}` : r.pairs}</td>
                  <td className={`${td} tabular text-right whitespace-nowrap`}>
                    {r.kind === "return" ? "−" : ""}
                    {formatPrice(r.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Pager page={page} pageCount={pageCount} total={total} unit="fiş" hrefFor={(p) => qs("/yonetim/muhasebe/fisler", { uretici: manufacturerId, sayfa: p })} />
    </>
  );
}
