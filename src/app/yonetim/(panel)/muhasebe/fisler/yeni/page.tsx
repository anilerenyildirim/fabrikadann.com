import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, param } from "@/components/admin/ui";
import { PurchaseForm } from "@/components/admin/PurchaseForm";
import { Button, SelectField } from "@/components/ui/form";
import { requireAdmin } from "@/server/auth/current";
import { getManufacturer, manufacturerOptions } from "@/server/services/admin/manufacturers";
import { istanbulDate, purchaseCatalog } from "@/server/services/admin/purchases";
import { createPurchaseAction } from "../../actions";

export const metadata: Metadata = { title: "Mal alımı" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NewPurchasePage({ searchParams }: Props) {
  await requireAdmin();
  const manufacturerId = param((await searchParams).uretici, 60);
  const manufacturer = manufacturerId ? await getManufacturer(manufacturerId) : null;

  if (!manufacturer) {
    const options = await manufacturerOptions();
    return (
      <>
        <PageHeader
          title="Mal alımı / iade"
          back={{ href: "/yonetim/muhasebe/fisler", label: "Fişler" }}
          description="Önce malı getiren üreticiyi seçin; o üreticinin ürünleri numara numara listelenir."
        />
        {options.length === 0 ? (
          <p className="text-[0.8125rem] text-graphite">
            Henüz üretici yok.{" "}
            <Link href="/yonetim/ureticiler/yeni" className="text-ink underline underline-offset-4">
              Üretici ekleyin
            </Link>
            , sonra ürünlerde üreticiyi seçin.
          </p>
        ) : (
          <form method="get" className="flex max-w-xl flex-col gap-4 sm:flex-row sm:items-end">
            <SelectField label="Üretici" name="uretici" defaultValue="" className="sm:flex-1" required>
              <option value="" disabled>
                Üretici seçin
              </option>
              {options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </SelectField>
            <Button type="submit" className="min-h-11 px-4">
              Devam et
            </Button>
          </form>
        )}
      </>
    );
  }

  const products = await purchaseCatalog(manufacturer.id);
  return (
    <>
      <PageHeader
        title={`Mal alımı / iade — ${manufacturer.name}`}
        back={{ href: `/yonetim/ureticiler/${manufacturer.id}`, label: manufacturer.name }}
        description="Gelen ya da geri gönderilen adetleri girin. Kaydedilen fiş stoğu ve üreticinin cari hesabını hemen günceller; sonradan silinmez, yanlışlık ters fişle düzeltilir."
        actions={
          <Link href="/yonetim/muhasebe/fisler/yeni" className="label inline-flex min-h-11 items-center text-graphite underline underline-offset-4">
            Başka üretici seç
          </Link>
        }
      />
      {!manufacturer.active && (
        <p className="mb-6 text-[0.8125rem] text-graphite">Üretici pasif: yalnızca iade fişi girilebilir.</p>
      )}
      {products.length === 0 ? (
        <p className="text-[0.8125rem] text-graphite">
          Bu üreticiye bağlı, numarası girilmiş ürün yok. Ürün sayfasında üreticiyi seçin ve numaraları ekleyin.
        </p>
      ) : (
        <PurchaseForm action={createPurchaseAction} manufacturer={{ id: manufacturer.id, name: manufacturer.name }} products={products} today={istanbulDate()} />
      )}
    </>
  );
}
