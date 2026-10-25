import type { ProductDetail } from "@/server/services/catalog";

/**
 * schema.org Product. Metin alanları kullanıcı (yönetici) girdisi olabileceği için
 * "<" kaçırılır: </script> ile etiketten çıkılamaz.
 */
export function ProductJsonLd({ product, siteUrl }: { product: ProductDetail; siteUrl: string }) {
  const url = `${siteUrl}/urun/${product.slug}`;
  const images = product.colors
    .flatMap((c) => c.images)
    .slice(0, 10)
    .map((img) => `${siteUrl}/medya/${img.storageKey}-1200.webp`);
  const inStock = product.colors.some((c) => c.variants.some((v) => v.availability !== "out"));

  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || undefined,
    image: images.length ? images : undefined,
    url,
    brand: { "@type": "Brand", name: "fabrikadann" },
    category: product.category?.name,
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "TRY",
      price: (product.price / 100).toFixed(2),
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
