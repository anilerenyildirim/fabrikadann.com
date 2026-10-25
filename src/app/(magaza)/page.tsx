import type { Metadata } from "next";
import Link from "next/link";
import { CategoryTiles } from "@/components/home/CategoryTiles";
import { Hero } from "@/components/home/Hero";
import { ProductGrid } from "@/components/product/ProductGrid";
import { listAvailableSizes, listCategories, listFeaturedProducts, listProducts } from "@/server/services/catalog";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function HomePage() {
  const [featured, latest, categories, sizes] = await Promise.all([
    listFeaturedProducts(1),
    listProducts({ sort: "new" }),
    listCategories(),
    listAvailableSizes(),
  ]);

  // Her kategoriden bir ürün görseli; ürünü olmayan kategori gösterilmez
  const tiles = (
    await Promise.all(
      categories.map(async (c) => {
        const { items } = await listProducts({ categorySlug: c.slug, sort: "new" });
        const withImage = items.find((p) => p.image);
        return withImage ? { name: c.name, slug: c.slug, image: withImage.image } : null;
      }),
    )
  ).filter((t) => t !== null);

  const heroProduct = featured.find((p) => p.image) ?? latest.items.find((p) => p.image) ?? null;
  const newest = latest.items.slice(0, 8);

  return (
    <>
      <Hero
        image={heroProduct?.image ?? null}
        secondImage={heroProduct?.hoverImage ?? null}
        caption={collectionCaption(latest.total, sizes)}
      />

      <section className="mx-auto max-w-xl px-6 py-24 text-center md:py-32">
        <h2 className="wide text-base md:text-lg">Fabrikadan, aracısız.</h2>
        <p className="mt-5 text-[0.9375rem] leading-relaxed text-graphite">
          Ayakkabılarımız üreticiden doğrudan size gelir. Bu yüzden bu sitedeki fiyatlar, diğer satış kanallarımızdaki
          (Trendyol) fiyatlardan daha düşüktür.
        </p>
      </section>

      <CategoryTiles tiles={tiles} />

      {newest.length > 0 && (
        <section aria-labelledby="yeni-gelenler" className="mt-24 md:mt-32">
          <div className="flex items-center justify-between gap-4 px-4 pb-4 md:px-6">
            <h2 id="yeni-gelenler" className="wide text-[0.9375rem] md:text-base">
              Yeni gelenler
            </h2>
            <Link href="/urunler" className="label inline-flex min-h-11 items-center hover:underline hover:underline-offset-4">
              Tümünü gör
            </Link>
          </div>
          <ProductGrid products={newest} />
        </section>
      )}
    </>
  );
}

/** "8 model · 36–45 numara": koleksiyonu veriden özetler. */
function collectionCaption(total: number, sizes: string[]): string | null {
  if (total === 0) return null;
  const parts = [`${total} model`];
  const first = sizes[0];
  const last = sizes.at(-1);
  if (first && last) parts.push(first === last ? `${first} numara` : `${first}–${last} numara`);
  return parts.join(" · ");
}
