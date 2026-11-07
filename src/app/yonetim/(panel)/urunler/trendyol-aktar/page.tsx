import type { Metadata } from "next";
import { Empty, PageHeader } from "@/components/admin/ui";
import { TrendyolImportForm } from "@/components/admin/TrendyolImportForm";
import { FormNotice } from "@/components/ui/form";
import { requireAdmin } from "@/server/auth/current";
import { logError } from "@/server/log";
import { listTrendyolImportCandidates, type ImportCandidate } from "@/server/services/admin/trendyol-import";
import { TrendyolClient, TrendyolError, trendyolConfig } from "@/server/trendyol/client";
import { importTrendyolProductAction } from "./actions";

export const metadata: Metadata = { title: "Trendyol'dan ürün aktar" };

const DESCRIPTION =
  "Trendyol'daki onaylı ürünleriniz. Seçtikleriniz taslak olarak aktarılır: aynı model kodundaki renkler tek ürün, her numara Trendyol barkodu ve stoğuyla gelir. Site fiyatı Trendyol fiyatından %25 indirimli hesaplanır; oranı ürün sayfasından değiştirebilirsiniz. Aktarılan ürünlerin üreticisini ve alış fiyatını ürün sayfasından girin.";

export default async function TrendyolImportPage() {
  const user = await requireAdmin();
  const back = { href: "/yonetim/urunler", label: "Ürünler" };

  let error: string | null = null;
  let data: { candidates: ImportCandidate[]; skipped: number; truncated: boolean } | null = null;
  try {
    const cfg = trendyolConfig();
    if (!cfg) {
      error = "Trendyol bağlantısı tanımlı değil. Sunucuda TRENDYOL_SELLER_ID, TRENDYOL_API_KEY ve TRENDYOL_API_SECRET tanımlayın.";
    } else {
      data = await listTrendyolImportCandidates({ actorId: user.id }, { client: new TrendyolClient(cfg) });
    }
  } catch (e) {
    if (e instanceof TrendyolError) error = `Trendyol ürünleri okunamadı: ${e.message}. Biraz sonra sayfayı yenileyin.`;
    else {
      logError("[trendyol-aktar] liste", e);
      error = "Trendyol ürünleri okunamadı. Sayfayı yenileyin; sorun sürerse sunucu kayıtlarına bakın.";
    }
  }

  return (
    <>
      <PageHeader title="Trendyol'dan ürün aktar" back={back} description={DESCRIPTION} />
      {error && <FormNotice>{error}</FormNotice>}
      {data && (
        <>
          {(data.skipped > 0 || data.truncated) && (
            <div className="mb-6">
              <FormNotice tone="info">
                {data.skipped > 0 && <span className="block">Trendyol'dan gelen {data.skipped} kayıt okunamadı ve listede yok.</span>}
                {data.truncated && <span className="block">Liste çok uzun; yalnızca ilk 5.000 içerik gösteriliyor.</span>}
              </FormNotice>
            </div>
          )}
          {data.candidates.length === 0 ? (
            <Empty>Trendyol'da onaylı ürün bulunamadı.</Empty>
          ) : (
            <TrendyolImportForm action={importTrendyolProductAction} candidates={data.candidates} />
          )}
        </>
      )}
    </>
  );
}
