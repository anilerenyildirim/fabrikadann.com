import type { Metadata } from "next";
import Link from "next/link";
import { MonthNav } from "@/components/admin/MonthNav";
import { PageHeader, param, Section, Stat, table, TableWrap, td, th } from "@/components/admin/ui";
import { ButtonLink, FormNotice } from "@/components/ui/form";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { accountingSummary, inventoryValue, manufacturerBalances, monthRange } from "@/server/services/admin/accounting";
import { istanbulDate } from "@/server/services/admin/purchases";

export const metadata: Metadata = { title: "Muhasebe" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const signed = (k: number) => `${k < 0 ? "−" : ""}${formatPrice(Math.abs(k))}`;

export default async function AccountingPage({ searchParams }: Props) {
  await requireAdmin();
  const { month, from, to } = monthRange(param((await searchParams).ay, 7));
  const [s, inventory, balances] = await Promise.all([accountingSummary(from, to), inventoryValue(), manufacturerBalances()]);
  const debt = balances.reduce((n, b) => n + b.balance, 0);
  const expenses = s.categories.filter((c) => c.kind === "expense");
  const incomes = s.categories.filter((c) => c.kind === "income");

  const rows: { label: string; value: number; strong?: boolean; hint?: string }[] = [
    { label: "Site ürün satışı", value: s.siteRevenue, hint: `${s.siteOrders} sipariş, ${s.sitePairs} çift` },
    { label: "Site kargo geliri", value: s.shippingRevenue },
    ...incomes.map((c) => ({ label: c.label, value: c.total, hint: `${c.entries} kayıt` })),
    { label: "Satılan malın maliyeti", value: -s.cost, hint: `Site ${formatPrice(s.siteCost)} · Trendyol ${s.trendyolPairs} çift ${formatPrice(s.trendyolCost)}` },
    { label: "Brüt kâr", value: s.grossProfit, strong: true },
    ...expenses.map((c) => ({ label: c.label, value: -c.total, hint: `${c.entries} kayıt` })),
    { label: "Net sonuç", value: s.net, strong: true },
  ];

  return (
    <>
      <PageHeader
        title="Muhasebe"
        description="Aylık gelir-gider özeti, üretici borçları ve stok değeri. Tutarlar KDV dahil; resmî muhasebe kaydının yerine geçmez."
        actions={
          <>
            <ButtonLink href="/yonetim/muhasebe/gelir-gider" variant="secondary" className="min-h-11 px-4">
              Gelir / gider gir
            </ButtonLink>
            <ButtonLink href="/yonetim/muhasebe/fisler/yeni" className="min-h-11 px-4">
              Mal alımı gir
            </ButtonLink>
          </>
        }
      />
      <nav aria-label="Muhasebe bölümleri" className="rail -mx-4 mb-8 gap-1 border-y border-rule px-4 md:mx-0 md:px-0">
        {[
          ["/yonetim/muhasebe/gelir-gider", "Gelir ve giderler"],
          ["/yonetim/muhasebe/fisler", "Alış ve iade fişleri"],
          ["/yonetim/ureticiler", "Üreticiler ve cari"],
        ].map(([href, label]) => (
          <Link key={href} href={href!} className="label inline-flex min-h-11 items-center px-3 whitespace-nowrap text-graphite hover:text-ink">
            {label}
          </Link>
        ))}
      </nav>

      <MonthNav base="/yonetim/muhasebe" month={month} current={istanbulDate().slice(0, 7)} />
      <p className="-mt-4 mb-8 flex flex-wrap items-center gap-x-4 text-[0.8125rem]">
        <span className="text-graphite">Muhasebeci için (Excel, CSV):</span>
        <a href={`/yonetim/muhasebe/disa-aktar?ay=${month}&tur=gelir-gider`} className="inline-flex min-h-11 items-center underline underline-offset-4">
          Gelir-gider listesi
        </a>
        <a href={`/yonetim/muhasebe/disa-aktar?ay=${month}&tur=fisler`} className="inline-flex min-h-11 items-center underline underline-offset-4">
          Alış ve iade fişleri
        </a>
      </p>

      {(s.pairsWithoutCost > 0 || inventory.productsWithoutCost > 0 || inventory.productsWithoutManufacturer > 0) && (
        <div className="mb-8 max-w-3xl">
          <FormNotice>
            {s.pairsWithoutCost > 0 && (
              <span className="block">Bu ay satılan {s.pairsWithoutCost} çiftin alış fiyatı yok; maliyet ve kâr eksik hesaplanıyor.</span>
            )}
            {inventory.productsWithoutCost > 0 && (
              <span className="block">{inventory.productsWithoutCost} üründe alış fiyatı girilmemiş.</span>
            )}
            {inventory.productsWithoutManufacturer > 0 && (
              <span className="block">{inventory.productsWithoutManufacturer} üründe üretici seçilmemiş.</span>
            )}
            <Link href="/yonetim/urunler/tedarik?eksik=1" className="mt-1 inline-flex min-h-11 items-center underline underline-offset-4">
              Üretici ve alış fiyatlarını toplu gir
            </Link>
          </FormNotice>
        </div>
      )}

      <div className="mb-10 grid grid-cols-2 gap-x-6 lg:grid-cols-4">
        <Stat label="Net sonuç" value={signed(s.net)} hint="Bu ay" />
        <Stat label="Brüt kâr" value={signed(s.grossProfit)} hint="Satış − satılan malın maliyeti" />
        <Stat label="Üreticilere borç" value={signed(debt)} hint="Bugün itibarıyla" href="/yonetim/ureticiler" />
        <Stat label="Stoğun alış değeri" value={formatPrice(inventory.value)} hint={`${inventory.pairs} çift`} />
      </div>

      <Section title="Gelir tablosu" description="Site satışı ödeme tarihine göre; iptal ve iade edilen siparişler hariç. Trendyol satış geliri, hakediş gelir olarak girildiğinde görünür.">
        <TableWrap label="Gelir tablosu">
          <table className={`${table} max-w-3xl min-w-[480px]`}>
            <thead>
              <tr>
                <th className={th}>Kalem</th>
                <th className={`${th} text-right`}>Tutar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className={`${td} ${r.strong ? "border-ink font-medium" : ""}`}>
                    {r.label}
                    {r.hint && <span className="block text-[0.75rem] text-graphite">{r.hint}</span>}
                  </td>
                  <td className={`${td} tabular text-right whitespace-nowrap ${r.strong ? "border-ink font-medium" : ""}`}>{signed(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {(s.manufacturerPayments > 0 || s.manufacturerRefunds > 0) && (
          <p className="mt-4 max-w-3xl text-[0.8125rem] text-graphite">
            Bu ay üreticilere {formatPrice(s.manufacturerPayments)} ödendi
            {s.manufacturerRefunds > 0 ? `, ${formatPrice(s.manufacturerRefunds)} tahsil edildi` : ""}. Bunlar borç kapama
            olduğu için kâr hesabına girmez; maliyet satılan malın maliyetinde yer alır.
          </p>
        )}
      </Section>
    </>
  );
}
