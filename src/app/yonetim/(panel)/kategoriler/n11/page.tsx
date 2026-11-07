import type { Metadata } from "next";
import { ActionButton } from "@/components/admin/forms";
import { N11CategoryList } from "@/components/admin/N11CategoryList";
import { Empty, PageHeader } from "@/components/admin/ui";
import { FormNotice } from "@/components/ui/form";
import { requireAdmin } from "@/server/auth/current";
import { N11_NOT_CONFIGURED } from "@/server/marketplaces/n11";
import { n11Config } from "@/server/marketplaces/n11/client";
import { getCategoryMappings, n11CategoryCount } from "@/server/services/admin/n11";
import {
  deleteN11MappingAction,
  n11AttributesAction,
  refreshN11CategoriesAction,
  saveN11MappingAction,
  searchN11CategoriesAction,
} from "./actions";

export const metadata: Metadata = { title: "N11 kategori eşleştirme" };

export default async function N11CategoriesPage() {
  await requireAdmin();
  const [rows, count] = await Promise.all([getCategoryMappings(), n11CategoryCount()]);
  let configError: string | null = null;
  try {
    if (!n11Config()) configError = N11_NOT_CONFIGURED;
  } catch (e) {
    configError = e instanceof Error ? e.message : "N11 ayarları hatalı.";
  }
  return (
    <>
      <PageHeader
        title="N11 kategori eşleştirme"
        back={{ href: "/yonetim/kategoriler", label: "Kategoriler" }}
        description="Her site kategorisini bir kez N11'deki karşılığına bağlayın; o kategorideki ürünler N11'e bu kategoriyle ve burada seçtiğiniz özelliklerle (ör. Cinsiyet) gider."
        actions={
          !configError ? (
            <ActionButton
              action={refreshN11CategoriesAction}
              fields={{}}
              label={count ? "Kategorileri N11'den yenile" : "Kategorileri N11'den al"}
              pendingLabel="Alınıyor…"
            />
          ) : undefined
        }
      />
      {configError && (
        <div className="mb-6">
          <FormNotice>{configError}</FormNotice>
        </div>
      )}
      {!configError && count === 0 && (
        <div className="mb-6">
          <FormNotice tone="info">Önce "Kategorileri N11'den al"a basın; N11 kategori listesi bir kez indirilir.</FormNotice>
        </div>
      )}
      {rows.length === 0 ? (
        <Empty>Henüz site kategorisi yok.</Empty>
      ) : (
        <N11CategoryList
          rows={rows}
          disabled={!!configError || count === 0}
          remove={deleteN11MappingAction}
          actions={{ search: searchN11CategoriesAction, attributes: n11AttributesAction, save: saveN11MappingAction }}
        />
      )}
    </>
  );
}
