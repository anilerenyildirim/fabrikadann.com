import type { Metadata } from "next";
import { ProductInfoForm } from "@/components/admin/product/ProductInfoForm";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { categoryOptions } from "@/server/services/admin/catalog";
import { createProductAction } from "../actions";

export const metadata: Metadata = { title: "Yeni ürün" };

export default async function NewProductPage() {
  await requireAdmin();
  const categories = await categoryOptions();
  return (
    <>
      <PageHeader
        title="Yeni ürün"
        back={{ href: "/yonetim/urunler", label: "Ürünler" }}
        description="Önce temel bilgileri girin. Kaydettikten sonra renk, görsel ve numaraları ekleyip ürünü yayına alırsınız."
      />
      <ProductInfoForm
        mode="create"
        action={createProductAction}
        categories={categories}
        initial={{
          name: "",
          slug: "",
          description: "",
          details: "",
          categoryId: "",
          price: "",
          trendyolPrice: "",
          status: "draft",
          featured: false,
        }}
      />
    </>
  );
}
