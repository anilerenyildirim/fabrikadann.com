import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/admin/PrintButton";
import { formatDate, formatDateTime, PageHeader, table, TableWrap, td, th } from "@/components/admin/ui";
import { FormNotice } from "@/components/ui/form";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { getPurchase, PURCHASE_KIND_LABELS, purchaseRef } from "@/server/services/admin/purchases";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireAdmin();
  const p = await getPurchase((await params).id);
  return { title: p ? `Fiş ${purchaseRef(p.number, p.kind)}` : "Fiş bulunamadı" };
}

export default async function PurchasePage({ params, searchParams }: Props) {
  await requireAdmin();
  const p = await getPurchase((await params).id);
  if (!p) notFound();
  const isNew = (await searchParams).yeni === "1";
  const pairs = p.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`${PURCHASE_KIND_LABELS[p.kind]} ${purchaseRef(p.number, p.kind)}`}
          back={{ href: "/yonetim/muhasebe/fisler", label: "Fişler" }}
          actions={<PrintButton />}
        />
        {isNew && (
          <div className="mb-6">
            <FormNotice tone="info">
              Fiş kaydedildi. Stok {p.kind === "purchase" ? "artırıldı" : "düşüldü"} ve {p.manufacturerName} carisine{" "}
              {p.kind === "purchase" ? "borç yazıldı" : "iade düşüldü"}.
            </FormNotice>
          </div>
        )}
      </div>
      <h1 className="wide mb-4 hidden text-base print:block">
        {PURCHASE_KIND_LABELS[p.kind]} {purchaseRef(p.number, p.kind)}
      </h1>
      <dl className="mb-8 grid grid-cols-2 gap-x-6 gap-y-3 text-[0.8125rem] sm:grid-cols-4">
        <div>
          <dt className="label text-graphite">Üretici</dt>
          <dd>
            <Link href={`/yonetim/ureticiler/${p.manufacturerId}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
              {p.manufacturerName}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="label text-graphite">Tarih</dt>
          <dd className="tabular flex min-h-11 items-center">{formatDate(`${p.date}T12:00:00Z`)}</dd>
        </div>
        <div>
          <dt className="label text-graphite">Toplam</dt>
          <dd className="tabular flex min-h-11 items-center">
            {pairs} çift · {formatPrice(p.total)}
          </dd>
        </div>
        <div>
          <dt className="label text-graphite">Kaydeden</dt>
          <dd className="flex min-h-11 flex-col justify-center">
            <span className="break-all">{p.actorEmail ?? "—"}</span>
            <span className="text-graphite">{formatDateTime(p.createdAt)}</span>
          </dd>
        </div>
        {p.note && (
          <div className="col-span-2 sm:col-span-4">
            <dt className="label text-graphite">Not</dt>
            <dd>{p.note}</dd>
          </div>
        )}
      </dl>
      <TableWrap label="Fiş satırları">
        <table className={`${table} min-w-[640px]`}>
          <thead>
            <tr>
              <th className={th}>Ürün</th>
              <th className={th}>Numara</th>
              <th className={th}>Üretim barkodu</th>
              <th className={`${th} text-right`}>Adet</th>
              <th className={`${th} text-right`}>Birim</th>
              <th className={`${th} text-right`}>Tutar</th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((i) => (
              <tr key={i.id}>
                <td className={td}>
                  {i.productId ? (
                    <Link href={`/yonetim/urunler/${i.productId}`} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                      {i.productName}
                    </Link>
                  ) : (
                    i.productName
                  )}
                  <span className="block text-[0.75rem] text-graphite">{i.colorName}</span>
                </td>
                <td className={`${td} tabular`}>{i.size}</td>
                <td className={`${td} tabular text-graphite`}>{i.productionBarcode}</td>
                <td className={`${td} tabular text-right`}>{i.quantity}</td>
                <td className={`${td} tabular text-right whitespace-nowrap`}>{formatPrice(i.unitCost)}</td>
                <td className={`${td} tabular text-right whitespace-nowrap`}>{formatPrice(i.unitCost * i.quantity)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={`${td} border-ink font-medium`} colSpan={3}>
                Toplam
              </td>
              <td className={`${td} tabular border-ink text-right`}>{pairs}</td>
              <td className={`${td} border-ink`} />
              <td className={`${td} tabular border-ink text-right font-medium whitespace-nowrap`}>{formatPrice(p.total)}</td>
            </tr>
          </tfoot>
        </table>
      </TableWrap>
    </>
  );
}
