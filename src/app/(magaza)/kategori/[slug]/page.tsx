import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ProductListing } from "@/components/product/ProductListing";
import { isSlug, parseListingParams, type SearchParams } from "@/lib/listing";
import { getCategoryBySlug } from "@/server/services/catalog";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> };

// generateMetadata ve sayfa aynı istekte tek sorgu kullansın
const loadCategory = cache(async (slug: string) => (isSlug(slug) ? getCategoryBySlug(slug) : null));

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const category = await loadCategory(slug);
  if (!category) return { title: "Kategori bulunamadı" };
  const { page } = parseListingParams(sp);
  const path = `/kategori/${category.slug}`;
  return {
    title: category.name,
    description: `fabrikadann ${category.name.toLocaleLowerCase("tr-TR")} modelleri: üreticiden doğrudan, uygun fiyatla.`,
    alternates: { canonical: page > 1 ? `${path}?sayfa=${page}` : path },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const category = await loadCategory(slug);
  if (!category) notFound();
  return (
    <ProductListing
      title={category.name}
      path={`/kategori/${category.slug}`}
      categorySlug={category.slug}
      searchParams={sp}
    />
  );
}
