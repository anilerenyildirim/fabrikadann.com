import type { Metadata } from "next";
import { ProductListing } from "@/components/product/ProductListing";
import { parseListingParams, type SearchParams } from "@/lib/listing";

type Props = { searchParams: Promise<SearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { page } = parseListingParams(await searchParams);
  return {
    title: "Tüm ürünler",
    description: "fabrikadann ayakkabıları: üreticiden doğrudan, diğer satış kanallarımızdan daha uygun fiyatla.",
    alternates: { canonical: page > 1 ? `/urunler?sayfa=${page}` : "/urunler" },
  };
}

export default async function AllProductsPage({ searchParams }: Props) {
  return <ProductListing title="Tüm ürünler" path="/urunler" searchParams={await searchParams} />;
}
