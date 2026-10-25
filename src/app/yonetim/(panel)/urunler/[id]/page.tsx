import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, MoveButtons } from "@/components/admin/forms";
import { ImageUploader } from "@/components/admin/product/ImageUploader";
import { ProductInfoForm } from "@/components/admin/product/ProductInfoForm";
import {
  AddColorForm,
  AddVariantsForm,
  ImageAltForm,
  RenameColorForm,
  StockAdjustForm,
  VariantCodesForm,
} from "@/components/admin/product/ProductForms";
import { Empty, PageHeader, ProductStatusTag, Section, table, TableWrap, td, th } from "@/components/admin/ui";
import { FormNotice } from "@/components/ui/form";
import { ProductImage } from "@/components/ui/ProductImage";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { categoryOptions, getAdminProduct, publishProblem, type ProductStatus } from "@/server/services/admin/catalog";
import { adjustStockAction } from "../../stok/actions";
import {
  addColorAction,
  addVariantsAction,
  deleteColorAction,
  deleteImageAction,
  deleteVariantAction,
  moveColorAction,
  moveImageAction,
  renameColorAction,
  setProductStatusAction,
  updateImageAltAction,
  updateProductAction,
  updateVariantAction,
  uploadImageAction,
} from "../actions";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireAdmin();
  const product = await getAdminProduct((await params).id);
  return { title: product ? product.name : "Ürün bulunamadı" };
}

const priceInput = (k: number | null) => (k === null ? "" : formatPrice(k).replace(/\s*TL$/, ""));

const STATUS_ACTIONS: Record<ProductStatus, { to: ProductStatus; label: string; confirm?: string; primary?: boolean }[]> = {
  draft: [
    { to: "active", label: "Yayına al", primary: true },
    { to: "archived", label: "Arşivle", confirm: "Ürün arşivlensin mi? Vitrinden kalkar, sipariş geçmişi korunur." },
  ],
  active: [
    { to: "draft", label: "Taslağa al", confirm: "Ürün vitrinden kalksın mı? Sepetlerdeki bu ürün satın alınamaz hale gelir." },
    { to: "archived", label: "Arşivle", confirm: "Ürün arşivlensin mi? Vitrinden kalkar, sipariş geçmişi korunur." },
  ],
  archived: [
    { to: "draft", label: "Arşivden çıkar (taslak)" },
    { to: "active", label: "Yeniden yayına al" },
  ],
};

export default async function EditProductPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const [product, categories] = await Promise.all([getAdminProduct(id), categoryOptions()]);
  if (!product) notFound();
  const problem = await publishProblem(product.id);
  const totalStock = product.colors.reduce((n, c) => n + c.variants.reduce((m, v) => m + v.stock, 0), 0);
  const isNew = sp.yeni === "1";

  return (
    <>
      <PageHeader
        title={product.name}
        back={{ href: "/yonetim/urunler", label: "Ürünler" }}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ProductStatusTag status={product.status} />
            <span className="tabular">{formatPrice(product.price)}</span>
            <span>
              {product.colors.length} renk · toplam stok <span className="tabular">{totalStock}</span>
            </span>
            {product.status === "active" && (
              <Link
                href={`/urun/${product.slug}`}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center text-ink underline underline-offset-4"
              >
                Vitrinde gör <span aria-hidden="true">&nbsp;↗</span>
              </Link>
            )}
          </span>
        }
        actions={STATUS_ACTIONS[product.status].map((a) => (
          <ActionButton
            key={a.to}
            action={setProductStatusAction}
            fields={{ productId: product.id, status: a.to }}
            label={a.label}
            pendingLabel="Kaydediliyor…"
            confirm={a.confirm}
            variant={a.primary && !problem ? "primary" : "secondary"}
          />
        ))}
      />

      {isNew && (
        <div className="mb-6">
          <FormNotice tone="info">
            Ürün taslak olarak oluşturuldu. Şimdi aşağıdan renk ekleyin, görsellerini yükleyin ve numaralarını girin; sonra
            yayına alın.
          </FormNotice>
        </div>
      )}
      {product.status !== "active" && problem && !isNew && (
        <div className="mb-6">
          <FormNotice tone="info">{problem}</FormNotice>
        </div>
      )}

      <nav aria-label="Bölümler" className="rail -mx-4 mb-8 gap-1 border-y border-rule px-4 md:mx-0 md:px-0">
        {[
          ["#bilgiler", "Bilgiler"],
          ["#renkler", "Renkler ve görseller"],
          ["#numaralar", "Numaralar ve stok"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="label inline-flex min-h-11 items-center px-3 whitespace-nowrap text-graphite hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <Section id="bilgiler" title="Bilgiler">
        <ProductInfoForm
          mode="edit"
          action={updateProductAction}
          categories={categories}
          publishProblem={problem}
          initial={{
            productId: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            details: product.details,
            categoryId: product.categoryId ?? "",
            price: priceInput(product.price),
            trendyolPrice: priceInput(product.trendyolPrice),
            status: product.status,
            featured: product.featured,
          }}
        />
      </Section>

      <Section
        id="renkler"
        title="Renkler ve görseller"
        description="Her rengin kendi görselleri olur. İlk görsel listede ve vitrinde kapak olarak görünür; ikincisi üzerine gelince gösterilir."
      >
        {product.colors.length === 0 && <Empty>Henüz renk yok. Aşağıdan ilk rengi ekleyin (ör. Siyah).</Empty>}
        {product.colors.map((color, ci) => (
          <article key={color.id} className="border-t border-ink pt-5 pb-8" aria-label={`Renk: ${color.name}`}>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
              <span className="label tabular mt-6 w-6 text-graphite" aria-hidden="true">
                {ci + 1}.
              </span>
              <RenameColorForm action={renameColorAction} colorId={color.id} name={color.name} />
              <div className="flex items-start gap-3 pt-4">
                <MoveButtons
                  action={moveColorAction}
                  fields={{ colorId: color.id }}
                  isFirst={ci === 0}
                  isLast={ci === product.colors.length - 1}
                  what={`${color.name} rengi`}
                />
                <ActionButton
                  action={deleteColorAction}
                  fields={{ colorId: color.id }}
                  label="Rengi sil"
                  pendingLabel="Siliniyor…"
                  confirm={`"${color.name}" rengi, görselleri ve numaralarıyla birlikte silinsin mi? Bu geri alınamaz.`}
                />
              </div>
            </div>

            {color.images.length === 0 ? (
              <p className="mt-5 text-[0.8125rem] text-graphite">Bu renkte görsel yok.</p>
            ) : (
              <ol className="mt-5 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
                {color.images.map((img, ii) => (
                  <li key={img.id} className="flex min-w-0 flex-col gap-2">
                    <ProductImage
                      image={{ key: img.storageKey, width: img.width, height: img.height, alt: img.alt || `${product.name}, ${color.name}` }}
                      sizes="(min-width: 1024px) 15vw, 45vw"
                      className="w-full"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="label text-graphite">{ii === 0 ? "Kapak" : `${ii + 1}. görsel`}</span>
                      <MoveButtons
                        action={moveImageAction}
                        fields={{ imageId: img.id }}
                        isFirst={ii === 0}
                        isLast={ii === color.images.length - 1}
                        what={`${ii + 1}. görsel`}
                      />
                    </div>
                    <ImageAltForm action={updateImageAltAction} imageId={img.id} alt={img.alt} />
                    <ActionButton
                      action={deleteImageAction}
                      fields={{ imageId: img.id }}
                      label="Görseli sil"
                      pendingLabel="Siliniyor…"
                      variant="quiet"
                      confirm="Görsel silinsin mi? Bu geri alınamaz."
                    />
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-6">
              <ImageUploader colorId={color.id} colorName={color.name} action={uploadImageAction} />
            </div>
          </article>
        ))}
        <div className="border-t border-rule pt-6">
          <AddColorForm action={addColorAction} productId={product.id} />
        </div>
      </Section>

      <Section
        id="numaralar"
        title="Numaralar ve stok"
        description="Stok Trendyol ile ortak: oradan satış olduğunda burada düşün ve sebebini yazın. Her değişiklik stok hareketlerine kaydedilir."
      >
        {product.colors.length === 0 && <Empty>Numara eklemek için önce bir renk ekleyin.</Empty>}
        {product.colors.map((color) => (
          <div key={color.id} className="border-t border-ink pt-5 pb-8">
            <h3 className="label mb-4">{color.name}</h3>
            {color.variants.length > 0 && (
              <TableWrap label={`${color.name} numaraları`}>
                <table className={`${table} mb-6 min-w-[900px]`}>
                  <thead>
                    <tr>
                      <th className={`${th} w-28`}>Numara</th>
                      <th className={th}>SKU ve barkod</th>
                      <th className={th}>Stok düzeltme</th>
                      <th className={`${th} w-24`}>
                        <span className="sr-only">Sil</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {color.variants.map((v) => (
                      <tr key={v.id}>
                        <td className={`${td} tabular text-base`}>
                          {v.size}
                          <span className="mt-1 block text-[0.75rem] text-graphite">
                            {v.stock === 0 ? "Tükendi" : `${v.stock} satılabilir`}
                            {v.reserved > 0 ? ` · ${v.reserved} ayrılmış` : ""}
                          </span>
                        </td>
                        <td className={td}>
                          <VariantCodesForm action={updateVariantAction} variantId={v.id} sku={v.sku} barcode={v.barcode} />
                        </td>
                        <td className={td}>
                          <StockAdjustForm action={adjustStockAction} variantId={v.id} stock={v.stock} reserved={v.reserved} compact />
                        </td>
                        <td className={td}>
                          <ActionButton
                            action={deleteVariantAction}
                            fields={{ variantId: v.id }}
                            label="Sil"
                            ariaLabel={`${color.name} ${v.size} numarasını sil`}
                            pendingLabel="…"
                            variant="quiet"
                            confirm={`${color.name} / ${v.size} numarası silinsin mi?`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <AddVariantsForm action={addVariantsAction} colorId={color.id} colorName={color.name} />
          </div>
        ))}
      </Section>
    </>
  );
}
