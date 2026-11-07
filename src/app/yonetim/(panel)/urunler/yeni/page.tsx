import type { Metadata } from "next";
import { PhotoStartForm } from "@/components/admin/product/PhotoStartForm";
import { ProductInfoForm } from "@/components/admin/product/ProductInfoForm";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { getSecret } from "@/server/secrets";
import { categoryOptions } from "@/server/services/admin/catalog";
import { manufacturerOptions } from "@/server/services/admin/manufacturers";
import { createProductAction, uploadImageAction } from "../actions";
import { startDraftAction } from "../asistan-actions";

export const metadata: Metadata = { title: "Yeni ürün" };

export default async function NewProductPage() {
  await requireAdmin();
  const [categories, manufacturers] = await Promise.all([categoryOptions(), manufacturerOptions()]);
  return (
    <>
      <PageHeader
        title="Yeni ürün"
        back={{ href: "/yonetim/urunler", label: "Ürünler" }}
        description="Fotoğraflarla başlayıp AI Asistan'ın önerilerini kullanabilir ya da aşağıdaki formla bilgileri elle girebilirsiniz."
      />
      <div className="mb-10">
        <PhotoStartForm
          start={startDraftAction}
          upload={uploadImageAction}
          manufacturers={manufacturers}
          enabled={!!(await getSecret("ANTHROPIC_API_KEY"))}
        />
      </div>
      <h2 className="label mb-4">Ya da elle girin</h2>
      <ProductInfoForm
        mode="create"
        action={createProductAction}
        categories={categories}
        manufacturers={manufacturers}
        initial={{
          name: "",
          slug: "",
          description: "",
          details: "",
          categoryId: "",
          price: "",
          trendyolPrice: "",
          trendyolDiscount: "",
          n11Price: "",
          status: "draft",
          featured: false,
          manufacturerId: "",
          purchasePrice: "",
        }}
      />
    </>
  );
}
