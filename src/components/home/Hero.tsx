import Link from "next/link";
import { Monogram } from "@/components/brand/Logo";
import { ProductImage } from "@/components/ui/ProductImage";
import type { ImageRef } from "@/server/services/catalog";

/**
 * Tam ekran vitrin: öne çıkan ürünün görseli, üstünde açılan iki N.
 * Masaüstünde (yatay ekran) ürünün iki görseli yan yana; mobilde yalnızca ilki.
 * Başlık ana sayfada bu bölümün üstüne şeffaf biner.
 */
export function Hero({ image, secondImage, caption }: { image: ImageRef | null; secondImage: ImageRef | null; caption: string | null }) {
  return (
    <section className="relative h-svh min-h-[30rem] overflow-hidden bg-fog">
      {image && (
        <div className={`absolute inset-0 grid ${secondImage ? "md:grid-cols-2" : ""}`}>
          <ProductImage
            image={image}
            ratio="auto"
            sizes={secondImage ? "(min-width: 768px) 50vw, 100vw" : "100vw"}
            priority
            className="h-full w-full"
          />
          {secondImage && (
            <ProductImage
              image={{ ...secondImage, alt: "" }}
              ratio="auto"
              sizes="50vw"
              className="hidden h-full w-full md:block"
            />
          )}
        </div>
      )}

      <div className="relative flex h-full flex-col items-center justify-center px-6 pt-14 md:pt-16">
        <h1 className="w-[min(70vw,30rem)]">
          <Monogram animate className="h-auto w-full text-ink" />
        </h1>
      </div>

      <div className="belir absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] text-center">
        {caption && <p className="label">{caption}</p>}
        <Link
          href="/urunler"
          className="label inline-flex min-h-11 items-center px-2 underline underline-offset-[6px] hover:no-underline"
        >
          Koleksiyonu gör
        </Link>
      </div>
    </section>
  );
}
