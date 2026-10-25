import type { ImageRef } from "@/server/services/catalog";
import { mediaSrcSet, mediaUrl } from "@/server/storage/images";

type Props = {
  image: ImageRef | null;
  sizes: string;
  className?: string;
  priority?: boolean;
  /** Görsel yoksa gösterilecek boş kutunun oranı */
  ratio?: string;
};

/** Ürün görseli: 4:5 kutu, yüklenene kadar gri zemin. */
export function ProductImage({ image, sizes, className = "", priority = false, ratio = "4 / 5" }: Props) {
  if (!image) {
    return <div className={`bg-fog ${className}`} style={{ aspectRatio: ratio }} aria-hidden="true" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- boyutlar yüklemede üretiliyor
    <img
      src={mediaUrl(image.key, 800)}
      srcSet={mediaSrcSet(image.key, image.width)}
      sizes={sizes}
      width={image.width}
      height={image.height}
      alt={image.alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={`bg-fog object-cover ${className}`}
      style={{ aspectRatio: ratio }}
    />
  );
}
