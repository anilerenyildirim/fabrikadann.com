import type { Metadata } from "next";
import Link from "next/link";
import { BalanceText } from "@/components/admin/BalanceText";
import { Empty, PageHeader, Stat, table, TableWrap, td, th } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/form";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { manufacturerBalances } from "@/server/services/admin/accounting";

export const metadata: Metadata = { title: "Üreticiler" };

export default async function ManufacturersPage() {
  await requireAdmin();
  const rows = await manufacturerBalances();
  const totalDebt = rows.reduce((n, r) => n + r.balance, 0);
  const totalDueBySales = rows.reduce((n, r) => n + Math.max(0, r.dueBySales), 0);
  return (
    <>
      <PageHeader
        title="Üreticiler"
        description="Ürünleri aldığınız atölyeler ve cari hesapları. Borç = devir + alış fişleri − iadeler − ödemeler."
        actions={
          <>
            <ButtonLink href="/yonetim/urunler/tedarik" variant="secondary" className="min-h-11 px-4">
              Ürünlere üretici ata
            </ButtonLink>
            <ButtonLink href="/yonetim/muhasebe/fisler/yeni" variant="secondary" className="min-h-11 px-4">
              Mal alımı gir
            </ButtonLink>
            <ButtonLink href="/yonetim/ureticiler/yeni" className="min-h-11 px-4">
              Üretici ekle
            </ButtonLink>
          </>
        }
      />
      {rows.length > 0 && (
        <div className="mb-10 grid gap-x-8 sm:grid-cols-2 lg:max-w-3xl">
          <Stat label="Üreticilere toplam borç" value={formatPrice(totalDebt)} hint="Teslim alınan mala göre" />
          <Stat label="Satılana göre ödenecek" value={formatPrice(totalDueBySales)} hint="Satılan ürünlerin alış maliyeti − ödemeler" />
        </div>
      )}
      {rows.length === 0 ? (
        <Empty>
          Henüz üretici yok.{" "}
          <Link href="/yonetim/ureticiler/yeni" className="text-ink underline underline-offset-4">
            İlk üreticiyi ekleyin
          </Link>
          ; sonra ürünlerde üreticiyi seçin.
        </Empty>
      ) : (
        <TableWrap label="Üretici listesi">
          <table className={`${table} min-w-[760px]`}>
            <thead>
              <tr>
                <th className={th}>Üretici</th>
                <th className={`${th} text-right`}>Ürün</th>
                <th className={`${th} text-right`}>Alınan</th>
                <th className={`${th} text-right`}>Ödenen</th>
                <th className={`${th} text-right`}>Bakiye</th>
                <th className={`${th} text-right`}>Satılana göre</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="hover:bg-fog">
                  <td className={td}>
                    <Link href={`/yonetim/ureticiler/${m.id}`} className="inline-flex min-h-11 flex-col justify-center underline-offset-4 hover:underline">
                      <span>{m.name}</span>
                      {!m.active && <span className="text-[0.75rem] text-graphite">Pasif</span>}
                    </Link>
                  </td>
                  <td className={`${td} tabular text-right`}>{m.products}</td>
                  <td className={`${td} tabular text-right whitespace-nowrap`}>{formatPrice(m.purchased - m.returned)}</td>
                  <td className={`${td} tabular text-right whitespace-nowrap`}>{formatPrice(m.paid - m.refunded)}</td>
                  <td className={`${td} tabular text-right`}>
                    <BalanceText amount={m.balance} />
                  </td>
                  <td className={`${td} tabular text-right`}>
                    <BalanceText amount={m.dueBySales} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
