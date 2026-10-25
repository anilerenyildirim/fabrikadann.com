import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/product/Pagination";
import { ProductGrid } from "@/components/product/ProductGrid";
import { listingHref, MAX_QUERY_LENGTH, pageCount, parseListingParams, type SearchParams } from "@/lib/listing";
import { listCategories, listProducts, PAGE_SIZE } from "@/server/services/catalog";

type Props = { searchParams: Promise<SearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = parseListingParams(await searchParams);
  return {
    title: q ? `“${q}” araması` : "Ara",
    // Arama sonuçları dizine eklenmez; bağlantılar izlenir
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q, page } = parseListingParams(await searchParams);
  const [result, categories] = await Promise.all([
    q ? listProducts({ q, page }) : Promise.resolve(null),
    listCategories(),
  ]);
  const pages = result ? pageCount(result.total, PAGE_SIZE) : 1;
  if (page > pages) notFound();

  return (
    <div>
      <section className="px-4 pb-8 pt-8 md:px-6 md:pb-12 md:pt-14">
        <h1 className="label text-graphite">
          <label htmlFor="arama">Ara</label>
        </h1>
        <Form action="/ara" role="search" className="mt-2">
          <div className="flex items-center gap-2 border-b-2 border-rule transition-colors focus-within:border-ink">
            <input
              id="arama"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Sneaker, bot, loafer…"
              maxLength={MAX_QUERY_LENGTH}
              enterKeyHint="search"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus={!q}
              className="min-h-14 w-full min-w-0 bg-transparent py-2 text-xl font-light outline-none [font-stretch:110%] placeholder:text-ash focus-visible:outline-none md:min-h-16 md:text-3xl"
            />
            <button type="submit" className="label inline-flex min-h-11 shrink-0 items-center px-2">
              Ara
            </button>
          </div>
        </Form>
      </section>

      {result && result.items.length > 0 && (
        <section aria-labelledby="sonuclar">
          <h2 id="sonuclar" className="label px-4 pb-4 text-graphite md:px-6">
            <span className="tabular">{result.total}</span> sonuç
          </h2>
          <ProductGrid products={result.items} priorityCount={4} label="Arama sonuçları" />
          <Pagination page={page} pages={pages} hrefFor={(p) => listingHref("/ara", { q, page: p })} />
        </section>
      )}

      {result && result.items.length === 0 && (
        <section className="px-4 py-12 md:px-6">
          <p className="wide text-[0.9375rem]">“{q}” için sonuç bulunamadı</p>
          <p className="mt-3 max-w-md text-graphite">
            Yazımı kontrol edin ya da daha kısa, genel bir kelime deneyin: “sneaker”, “bot”, “deri” gibi. Aşağıdaki
            kategorilere de göz atabilirsiniz.
          </p>
          <Suggestions categories={categories} />
        </section>
      )}

      {!result && (
        <section className="px-4 md:px-6">
          <Suggestions categories={categories} />
        </section>
      )}
    </div>
  );
}

function Suggestions({ categories }: { categories: { name: string; slug: string }[] }) {
  return (
    <nav aria-label="Kategoriler" className="mt-10">
      <p className="label text-graphite">Kategoriler</p>
      <ul className="mt-2">
        <li>
          <Link href="/urunler" className="wide inline-flex min-h-11 items-center text-[0.875rem] hover:underline hover:underline-offset-4">
            Tüm ürünler
          </Link>
        </li>
        {categories.map((c) => (
          <li key={c.slug}>
            <Link
              href={`/kategori/${c.slug}`}
              className="wide inline-flex min-h-11 items-center text-[0.875rem] hover:underline hover:underline-offset-4"
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
