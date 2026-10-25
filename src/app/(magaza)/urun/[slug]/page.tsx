import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Disclosure } from "@/components/product/Disclosure";
import { Gallery } from "@/components/product/Gallery";
import { ProductJsonLd } from "@/components/product/ProductJsonLd";
import { MobileBuyBar, PurchaseProvider, SizePicker } from "@/components/product/Purchase";
import { Price } from "@/components/ui/Price";
import { firstParam, isSlug, isUuid, type SearchParams } from "@/lib/listing";
import { formatPrice } from "@/lib/money";
import { getProductBySlug, type ProductDetail } from "@/server/services/catalog";
import { getSettings, type Settings } from "@/server/services/settings";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> };

// generateMetadata ve sayfa aynı istekte tek sorgu kullansın
const loadProduct = cache(async (slug: string) => (isSlug(slug) ? getProductBySlug(slug) : null));

const siteUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

function summarize(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function coverImage(product: ProductDetail) {
  return product.colors.flatMap((c) => c.images)[0] ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) return { title: "Ürün bulunamadı" };

  const description =
    summarize(product.description) || `${product.name}: fabrikadan, aracısız. ${formatPrice(product.price)}.`;
  const cover = coverImage(product);
  const ogWidth = cover ? Math.min(1200, cover.width) : 0;
  const path = `/urun/${product.slug}`;
  return {
    title: product.name,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "fabrikadann",
      locale: "tr_TR",
      url: path,
      title: product.name,
      description,
      images: cover
        ? [
            {
              url: `/medya/${cover.storageKey}-1200.webp`,
              width: ogWidth,
              height: Math.round((cover.height * ogWidth) / cover.width),
              alt: cover.alt || product.name,
            },
          ]
        : undefined,
    },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await loadProduct(slug);
  if (!product) notFound();

  const requested = firstParam(sp.renk);
  const color = (isUuid(requested) && product.colors.find((c) => c.id === requested)) || product.colors[0];
  if (!color) notFound();

  const settings = await getSettings();
  const defaultColorId = product.colors[0]?.id;

  return (
    <>
      <PurchaseProvider key={color.id} sizes={color.variants}>
        <div>
          <div className="md:grid md:grid-cols-[minmax(0,1fr)_20rem] lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
            <Gallery images={color.images} productName={product.name} colorName={color.name} />

            <div className="px-4 pb-10 pt-4 md:sticky md:top-16 md:max-h-[calc(100svh-4rem)] md:self-start md:overflow-y-auto md:px-6 md:pt-10 lg:px-10">
              {product.category && (
                <Link
                  href={`/kategori/${product.category.slug}`}
                  className="label inline-flex min-h-11 items-center text-graphite hover:text-ink"
                >
                  {product.category.name}
                </Link>
              )}
              <h1 className={`wide break-words text-base leading-snug md:text-[1.0625rem] ${product.category ? "" : "mt-4"}`}>
                {product.name}
              </h1>
              <div className="mt-3">
                <Price price={product.price} trendyolPrice={product.trendyolPrice} size="lg" showComparison />
              </div>

              <div className="mt-8">
                <p className="label text-graphite">Renk</p>
                {product.colors.length > 1 ? (
                  <ul className="mt-1 flex flex-wrap gap-x-6">
                    {product.colors.map((c) => {
                      const current = c.id === color.id;
                      return (
                        <li key={c.id}>
                          <Link
                            href={c.id === defaultColorId ? `/urun/${product.slug}` : `/urun/${product.slug}?renk=${c.id}`}
                            replace
                            aria-current={current ? "true" : undefined}
                            className={`label inline-flex min-h-11 items-center underline-offset-[6px] ${
                              current ? "underline" : "text-graphite hover:text-ink"
                            }`}
                          >
                            {c.name}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="label mt-3">{color.name}</p>
                )}
              </div>

              <SizePicker />

              {(product.description || product.details) && (
                <div className="mt-8 space-y-6 text-[0.8125rem] leading-relaxed">
                  {product.description && <p className="whitespace-pre-line">{product.description}</p>}
                  {product.details && (
                    <div>
                      <h2 className="label text-graphite">Detaylar</h2>
                      <p className="mt-2 whitespace-pre-line">{product.details}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-8 border-t border-rule">
                <Disclosure title="Kargo ve teslimat">
                  <p>Siparişiniz 2–4 iş günü içinde kargoya verilir.</p>
                  <p>{shippingNote(settings)}</p>
                </Disclosure>
                <Disclosure title="İade ve değişim">
                  <p>Ürünü teslim aldığınız günden itibaren 14 gün içinde iade edebilirsiniz.</p>
                  <p>
                    <Link href="/iade-degisim" className="inline-flex min-h-11 items-center text-ink underline underline-offset-4">
                      İade ve değişim koşulları
                    </Link>
                  </p>
                </Disclosure>
              </div>
            </div>
          </div>

          <MobileBuyBar />
        </div>
      </PurchaseProvider>
      <ProductJsonLd product={product} siteUrl={siteUrl()} />
    </>
  );
}

function shippingNote(settings: Pick<Settings, "shippingFee" | "freeShippingThreshold">): string {
  if (settings.shippingFee === 0 || settings.freeShippingThreshold === 0) return "Kargo ücretsiz.";
  return `${formatPrice(settings.freeShippingThreshold)} ve üzeri siparişlerde kargo ücretsiz; altındaki siparişlerde kargo ücreti ${formatPrice(settings.shippingFee)}.`;
}
