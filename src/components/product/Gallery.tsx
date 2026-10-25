import { ProductImage } from "@/components/ui/ProductImage";
import type { ProductDetail } from "@/server/services/catalog";
import { GalleryRail } from "./GalleryRail";

type ColorImage = ProductDetail["colors"][number]["images"][number];

// Tek görsel masaüstünde ekran yüksekliğine sığacak genişlikte, ortada
const SINGLE = "md:mx-auto md:max-w-[calc((100svh-4rem)*0.8)] lg:col-span-2";

/** Seçili rengin tüm görselleri: mobilde kaydırmalı şerit, tablette tek, masaüstünde iki sütun. */
export function Gallery({ images, productName, colorName }: { images: ColorImage[]; productName: string; colorName: string }) {
  const single = images.length <= 1;
  return (
    <GalleryRail count={Math.max(images.length, 1)} label={`${productName}, ${colorName}: görseller`}>
      {images.length === 0 ? (
        <li className={`w-full ${SINGLE}`}>
          <ProductImage image={null} sizes="100vw" className="w-full" />
        </li>
      ) : (
        images.map((img, i) => (
          <li key={img.id} className={`w-full ${single ? SINGLE : ""}`}>
            <ProductImage
              image={{
                key: img.storageKey,
                width: img.width,
                height: img.height,
                alt: img.alt || `${productName}, ${colorName}, görsel ${i + 1}`,
              }}
              sizes={
                single
                  ? "(min-width: 768px) 50vw, 100vw"
                  : "(min-width: 1024px) 33vw, (min-width: 768px) 60vw, 100vw"
              }
              priority={i === 0}
              className="block h-auto w-full"
            />
          </li>
        ))
      )}
    </GalleryRail>
  );
}
