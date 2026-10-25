import Link from "next/link";
import { notFound } from "next/navigation";
import { listingHref, pageCount, parseListingParams, SORTS, type SearchParams } from "@/lib/listing";
import { listAvailableSizes, listProducts, PAGE_SIZE } from "@/server/services/catalog";
import { FilterBar } from "./FilterBar";
import { Pagination } from "./Pagination";
import { ProductGrid } from "./ProductGrid";

/** /urunler ve /kategori/[slug] için ortak sayfa gövdesi. */
export async function ProductListing({
  title,
  path,
  categorySlug,
  searchParams,
}: {
  title: string;
  path: string;
  categorySlug?: string;
  searchParams: SearchParams;
}) {
  const query = parseListingParams(searchParams);
  const sizes = await listAvailableSizes();
  // Satışta olmayan numara seçilemez; URL'de kalmışsa yok sayılır
  const selectedSizes = query.sizes.filter((s) => sizes.includes(s));
  const { items, total } = await listProducts({
    categorySlug,
    sizes: selectedSizes,
    sort: SORTS[query.sort],
    page: query.page,
  });
  const pages = pageCount(total, PAGE_SIZE);
  if (query.page > pages) notFound();

  const filtered = selectedSizes.length > 0;

  return (
    <div>
      <header className="px-4 pb-6 pt-8 md:px-6 md:pb-8 md:pt-14">
        <h1 className="wide text-[1.0625rem] leading-tight md:text-xl">{title}</h1>
        <p className="label mt-2 text-graphite">
          <span className="tabular">{total}</span> ürün
        </p>
      </header>

      <FilterBar path={path} sizes={sizes} selectedSizes={selectedSizes} sort={query.sort} />

      {items.length > 0 ? (
        <div className="pt-0.5">
          <ProductGrid products={items} priorityCount={4} adjustable label={title} />
        </div>
      ) : (
        <div className="px-4 py-20 text-center md:py-28">
          {filtered ? (
            <>
              <p className="wide text-[0.9375rem]">Bu numaralarda ürün yok</p>
              <p className="mx-auto mt-3 max-w-sm text-graphite">
                Seçtiğiniz numaralarda şu an stokta ürün bulunmuyor. Filtreleri temizleyip tüm numaralara bakın.
              </p>
              <Link
                href={path}
                className="label mt-6 inline-flex min-h-11 items-center underline underline-offset-4"
              >
                Filtreleri temizle
              </Link>
            </>
          ) : (
            <>
              <p className="wide text-[0.9375rem]">Burada henüz ürün yok</p>
              <p className="mx-auto mt-3 max-w-sm text-graphite">Yeni modeller eklendiğinde burada göreceksiniz.</p>
              {categorySlug && (
                <Link
                  href="/urunler"
                  className="label mt-6 inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  Tüm ürünleri gör
                </Link>
              )}
            </>
          )}
        </div>
      )}

      <Pagination
        page={query.page}
        pages={pages}
        hrefFor={(page) => listingHref(path, { sizes: selectedSizes, sort: query.sort, page })}
      />
    </div>
  );
}
