import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ean13 } from "@/components/admin/Barcode";
import { PrintButton } from "@/components/admin/PrintButton";
import { PageHeader, param } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { getAdminProduct } from "@/server/services/admin/catalog";

export const metadata: Metadata = { title: "Barkod etiketleri" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Tek seferde basılabilecek en fazla etiket (yanlışlıkla binlerce sayfa çıkmasın)
const MAX_LABELS = 500;

export default async function LabelsPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  const byStock = param((await searchParams).kopya) === "stok";
  const product = await getAdminProduct(id);
  if (!product) notFound();

  const labels = product.colors.flatMap((c) =>
    c.variants.flatMap((v) =>
      Array.from({ length: byStock ? v.stock : 1 }, (_, i) => ({
        key: `${v.id}-${i}`,
        color: c.name,
        size: v.size,
        code: v.productionBarcode,
      })),
    ),
  );
  const shown = labels.slice(0, MAX_LABELS);
  const tab = (active: boolean) =>
    `label inline-flex min-h-11 items-center px-3 ${active ? "bg-ink text-paper" : "text-graphite hover:text-ink"}`;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Barkod etiketleri"
          back={{ href: `/yonetim/urunler/${product.id}#numaralar`, label: product.name }}
          description="Üretim barkodları (EAN-13). Etiket yazıcısında ya da A4 etiket kâğıdında yazdırın; barkod okuyucu alış fişinde bu kodu tanır."
          actions={<PrintButton />}
        />
        <nav aria-label="Etiket adedi" className="mb-6 flex flex-wrap gap-1">
          <Link href={`/yonetim/urunler/${product.id}/etiket`} className={tab(!byStock)} aria-current={!byStock ? "page" : undefined}>
            Her numaradan 1
          </Link>
          <Link
            href={`/yonetim/urunler/${product.id}/etiket?kopya=stok`}
            className={tab(byStock)}
            aria-current={byStock ? "page" : undefined}
          >
            Stok adedi kadar
          </Link>
        </nav>
        {labels.length > MAX_LABELS && (
          <p className="mb-6 text-[0.8125rem] text-graphite">
            {labels.length} etiketin ilk {MAX_LABELS} tanesi gösteriliyor.
          </p>
        )}
        {labels.length === 0 && <p className="text-[0.8125rem] text-graphite">Yazdırılacak etiket yok (stok 0).</p>}
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-2">
        {shown.map((l) => (
          <li key={l.key} className="flex break-inside-avoid flex-col gap-1 border border-rule p-3 print:border-ink">
            <span className="text-[0.75rem] leading-tight font-medium break-words">{product.name}</span>
            <span className="label tabular text-graphite print:text-ink">
              {l.color} · {l.size}
            </span>
            <Ean13 code={l.code} className="mt-1 w-full max-w-56" />
          </li>
        ))}
      </ul>
    </>
  );
}
