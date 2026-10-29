import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BalanceText } from "@/components/admin/BalanceText";
import { ActionButton } from "@/components/admin/forms";
import { LedgerEntryForm } from "@/components/admin/LedgerEntryForm";
import { ManufacturerForm } from "@/components/admin/ManufacturerForm";
import { Empty, formatDate, PageHeader, ProductStatusTag, Section, Stat, table, TableWrap, td, th } from "@/components/admin/ui";
import { ButtonLink } from "@/components/ui/form";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { manufacturerBalances, manufacturerProducts, manufacturerStatement } from "@/server/services/admin/accounting";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from "@/server/services/admin/ledger";
import { getManufacturer } from "@/server/services/admin/manufacturers";
import { istanbulDate } from "@/server/services/admin/purchases";
import { createLedgerEntryAction } from "../../muhasebe/actions";
import { deleteManufacturerAction, updateManufacturerAction } from "../actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireAdmin();
  const m = await getManufacturer((await params).id);
  return { title: m ? m.name : "Üretici bulunamadı" };
}

const amountInput = (k: number) => (k === 0 ? "" : `${k < 0 ? "-" : ""}${formatPrice(Math.abs(k)).replace(/\s*TL$/, "")}`);

export default async function ManufacturerPage({ params }: Props) {
  await requireAdmin();
  const { id } = await params;
  const m = await getManufacturer(id);
  if (!m) notFound();
  const [[balance], statement, products] = await Promise.all([
    manufacturerBalances(m.id),
    manufacturerStatement(m.id),
    manufacturerProducts(m.id),
  ]);
  const b = balance!;
  const canDelete = products.length === 0 && statement.length === 1 && m.openingBalance === 0;

  return (
    <>
      <PageHeader
        title={m.name}
        back={{ href: "/yonetim/ureticiler", label: "Üreticiler" }}
        description={
          <span className="flex flex-wrap gap-x-3">
            {!m.active && <span className="label">Pasif</span>}
            {m.contactName && <span>{m.contactName}</span>}
            {m.phone && (
              <a href={`tel:${m.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                {m.phone}
              </a>
            )}
          </span>
        }
        actions={
          m.active ? (
            <ButtonLink href={`/yonetim/muhasebe/fisler/yeni?uretici=${m.id}`} className="min-h-11 px-4">
              Mal alımı gir
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="mb-10 grid grid-cols-2 gap-x-6 lg:grid-cols-4">
        <Stat label="Bakiye" value={<BalanceText amount={b.balance} />} hint="Teslim alınan mala göre" />
        <Stat label="Satılana göre" value={<BalanceText amount={b.dueBySales} />} hint="Satılanların maliyeti − ödemeler" />
        <Stat label="Alınan mal" value={formatPrice(b.purchased - b.returned)} hint={b.returned ? `${formatPrice(b.returned)} iade düşüldü` : undefined} />
        <Stat label="Ödenen" value={formatPrice(b.paid - b.refunded)} hint={`Satılan maliyeti ${formatPrice(b.soldCost)}`} />
      </div>

      <Section id="odeme" title="Ödeme ya da tahsilat gir" description="Üreticiye yapılan ödeme borçtan düşer ve gelir-gider listesinde görünür.">
        <LedgerEntryForm
          action={createLedgerEntryAction}
          incomeCategories={INCOME_CATEGORIES}
          expenseCategories={EXPENSE_CATEGORIES}
          methods={PAYMENT_METHODS}
          manufacturers={[]}
          manufacturer={{ id: m.id, name: m.name }}
          today={istanbulDate()}
        />
      </Section>

      <Section id="ekstre" title="Cari ekstre" description="Tarih sırasıyla. Pozitif tutar borcunuzu artırır, negatif azaltır.">
        <TableWrap label="Cari ekstre">
          <table className={`${table} min-w-[640px]`}>
            <thead>
              <tr>
                <th className={th}>Tarih</th>
                <th className={th}>İşlem</th>
                <th className={`${th} text-right`}>Tutar</th>
                <th className={`${th} text-right`}>Bakiye</th>
              </tr>
            </thead>
            <tbody>
              {statement.map((r, i) => (
                <tr key={i}>
                  <td className={`${td} tabular whitespace-nowrap`}>{formatDate(`${r.date}T12:00:00Z`)}</td>
                  <td className={td}>
                    {r.href ? (
                      <Link href={r.href} className="inline-flex min-h-11 items-center underline underline-offset-4">
                        {r.label}
                      </Link>
                    ) : (
                      r.label
                    )}
                    {r.note && <span className="block text-[0.75rem] text-graphite">{r.note}</span>}
                  </td>
                  <td className={`${td} tabular text-right whitespace-nowrap`}>
                    {r.amount < 0 ? "−" : r.amount > 0 && r.kind !== "opening" ? "+" : ""}
                    {formatPrice(Math.abs(r.amount))}
                  </td>
                  <td className={`${td} tabular text-right`}>
                    <BalanceText amount={r.balance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section id="urunler" title={`Ürünler (${products.length})`} description="Satılan: site (ödenmiş, iptal/iade edilmemiş) ve Trendyol siparişleri.">
        {products.length === 0 ? (
          <Empty>Bu üreticiye bağlı ürün yok. Ürün sayfasında "Üretici" alanından seçin.</Empty>
        ) : (
          <TableWrap label="Üreticinin ürünleri">
            <table className={`${table} min-w-[760px]`}>
              <thead>
                <tr>
                  <th className={th}>Ürün</th>
                  <th className={`${th} text-right`}>Alış fiyatı</th>
                  <th className={`${th} text-right`}>Alınan</th>
                  <th className={`${th} text-right`}>İade</th>
                  <th className={`${th} text-right`}>Satılan</th>
                  <th className={`${th} text-right`}>Stok</th>
                  <th className={`${th} text-right`}>Stok değeri</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-fog">
                    <td className={td}>
                      <Link href={`/yonetim/urunler/${p.id}`} className="inline-flex min-h-11 flex-wrap items-center gap-2 underline-offset-4 hover:underline">
                        {p.name}
                        {p.status !== "active" && <ProductStatusTag status={p.status as "draft" | "archived"} />}
                      </Link>
                    </td>
                    <td className={`${td} tabular text-right whitespace-nowrap`}>
                      {p.purchasePrice === null ? <span className="label">Girilmedi</span> : formatPrice(p.purchasePrice)}
                    </td>
                    <td className={`${td} tabular text-right`}>{p.received}</td>
                    <td className={`${td} tabular text-right`}>{p.returned || "—"}</td>
                    <td className={`${td} tabular text-right whitespace-nowrap`}>
                      {p.soldSite + p.soldTrendyol}
                      {p.soldTrendyol > 0 && <span className="block text-[0.75rem] text-graphite">{p.soldTrendyol} Trendyol</span>}
                    </td>
                    <td className={`${td} tabular text-right`}>{p.stock}</td>
                    <td className={`${td} tabular text-right whitespace-nowrap`}>
                      {p.purchasePrice === null ? "—" : formatPrice(p.stock * p.purchasePrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section id="bilgiler" title="Bilgiler">
        <ManufacturerForm
          action={updateManufacturerAction}
          initial={{
            id: m.id,
            name: m.name,
            contactName: m.contactName,
            phone: m.phone,
            email: m.email,
            taxOffice: m.taxOffice,
            taxNumber: m.taxNumber,
            address: m.address,
            iban: m.iban,
            note: m.note,
            openingBalance: amountInput(m.openingBalance),
            active: m.active,
          }}
        />
        {canDelete && (
          <div className="mt-10 border-t border-rule pt-6">
            <ActionButton
              action={deleteManufacturerAction}
              fields={{ manufacturerId: m.id }}
              label="Üreticiyi sil"
              pendingLabel="Siliniyor…"
              confirm={`"${m.name}" silinsin mi?`}
            />
          </div>
        )}
      </Section>
    </>
  );
}
