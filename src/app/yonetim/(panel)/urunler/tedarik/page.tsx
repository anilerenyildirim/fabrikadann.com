import type { Metadata } from "next";
import Link from "next/link";
import { SupplyForm } from "@/components/admin/SupplyForm";
import { Empty, FilterLinks, PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { manufacturerOptions } from "@/server/services/admin/manufacturers";
import { listSupplyRows, supplyCounts } from "@/server/services/admin/supply";
import { saveSupplyAction } from "./actions";

export const metadata: Metadata = { title: "Üretici ve alış fiyatı" };

export default async function SupplyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const missingOnly = (await searchParams).eksik === "1";
  const [rows, counts, allManufacturers] = await Promise.all([
    listSupplyRows({ missingOnly }),
    supplyCounts(),
    manufacturerOptions(),
  ]);
  // Pasif üretici yalnızca zaten seçili olduğu satırda görünür
  const selected = new Set(rows.map((r) => r.manufacturerId).filter(Boolean));
  const extra = selected.size ? (await Promise.all([...selected].map((id) => manufacturerOptions(id)))).flat() : [];
  const options = [...new Map([...allManufacturers, ...extra].map((m) => [m.id, m])).values()].sort((a, b) =>
    a.name.localeCompare(b.name, "tr"),
  );

  return (
    <>
      <PageHeader
        title="Üretici ve alış fiyatı"
        back={{ href: "/yonetim/urunler", label: "Ürünler" }}
        description="Muhasebe bu bilgilerle hesaplanır: alış fiyatı satılan malın maliyetine, üretici cari hesaba geçer. Yalnızca yönetimde görünür; vitrine çıkmaz."
      />
      <FilterLinks
        label="Ürün filtresi"
        current={missingOnly ? "eksik" : "hepsi"}
        items={[
          { value: "hepsi", label: "Hepsi", href: "/yonetim/urunler/tedarik", count: counts.total },
          { value: "eksik", label: "Eksik olanlar", href: "/yonetim/urunler/tedarik?eksik=1", count: counts.missing },
        ]}
      />
      {options.length === 0 && (
        <p className="mb-6 max-w-2xl text-[0.8125rem]">
          Henüz üretici yok. Önce{" "}
          <Link href="/yonetim/ureticiler/yeni" className="inline-flex min-h-11 items-center underline underline-offset-4">
            üretici ekleyin
          </Link>
          .
        </p>
      )}
      {rows.length === 0 ? (
        <Empty>{missingOnly ? "Bütün ürünlerde üretici ve alış fiyatı girilmiş." : "Henüz ürün yok."}</Empty>
      ) : (
        <SupplyForm rows={rows} manufacturers={options} action={saveSupplyAction} />
      )}
    </>
  );
}
