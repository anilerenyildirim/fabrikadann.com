import { PageHeader } from "@/components/admin/ui";

/** Ürün listesi Trendyol'dan sayfa sayfa okunurken (birkaç saniye sürebilir) gösterilir. */
export default function Loading() {
  return (
    <>
      <PageHeader title="Trendyol'dan ürün aktar" back={{ href: "/yonetim/urunler", label: "Ürünler" }} />
      <div className="border border-ink p-4" role="status" aria-live="polite">
        <p className="mb-3 text-[0.8125rem]">
          <span className="label mr-2">Bekleyin</span>
          Trendyol'daki ürünleriniz okunuyor. Ürün sayısına göre birkaç saniye ile bir dakika arası sürer.
        </p>
        <div className="relative h-2 w-full overflow-hidden bg-fog" aria-hidden>
          <div className="ilerleme-akis absolute inset-y-0 w-1/3 bg-ink" />
        </div>
      </div>
    </>
  );
}
