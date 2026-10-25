import Link from "next/link";
import { Price } from "@/components/ui/Price";
import { ProductImage } from "@/components/ui/ProductImage";
import type { ProductCard as ProductCardData } from "@/server/services/catalog";
import { CARD_IMAGE_SIZES } from "./grid";

/**
 * Ürün kartı: 4:5 görsel, masaüstünde üzerine gelince ikinci görsel; altında küçük ad ve fiyat.
 * Görseller kartın metniyle aynı bağlantıda olduğu için alt metni boş (ad iki kez okunmasın).
 */
export function ProductCard({
  product,
  priority = false,
  sizes = CARD_IMAGE_SIZES,
}: {
  product: ProductCardData;
  priority?: boolean;
  sizes?: string;
}) {
  const notes = [!product.inStock && "Tükendi", product.colorCount > 1 && `${product.colorCount} renk`].filter(Boolean);
  return (
    <Link href={`/urun/${product.slug}`} className="group block focus-visible:outline-offset-[-2px]">
      <div className="relative overflow-hidden bg-fog">
        <ProductImage
          image={product.image && { ...product.image, alt: "" }}
          sizes={sizes}
          priority={priority}
          className="block h-auto w-full"
        />
        {product.hoverImage && (
          // display:none iken tembel yüklenen görsel indirilmez: mobilde ikinci görsel yüklenmez
          <ProductImage
            image={{ ...product.hoverImage, alt: "" }}
            sizes={sizes}
            className="absolute inset-0 hidden h-full w-full opacity-0 transition-opacity duration-300 md:block group-hover:opacity-100"
          />
        )}
      </div>
      <div className="px-2 pb-2 pt-2.5 md:px-3">
        <p className="text-[0.75rem] leading-snug">{product.name}</p>
        <div className="mt-0.5">
          <Price price={product.price} />
        </div>
        {notes.length > 0 && <p className="label mt-1 text-[0.6875rem] text-graphite">{notes.join(" · ")}</p>}
      </div>
    </Link>
  );
}
