/** Ürün ızgarası yoğunluğu: mobilde 1 ya da 2, masaüstünde 2 ya da 4 sütun (Zara gibi). */
export type Density = { mobile: 1 | 2; desktop: 2 | 4 };

export const DEFAULT_DENSITY: Density = { mobile: 2, desktop: 4 };

// Tailwind sınıfları tam yazılmalı (dinamik birleştirme taranmaz)
const MOBILE_COLS = { 1: "grid-cols-1", 2: "grid-cols-2" } as const;
const DESKTOP_COLS = { 2: "md:grid-cols-2", 4: "md:grid-cols-4" } as const;

/** Kartlar arası çok ince boşluk; metin satırları için dikeyde biraz daha fazla. */
export function gridClass(density: Density = DEFAULT_DENSITY): string {
  return `grid ${MOBILE_COLS[density.mobile]} ${DESKTOP_COLS[density.desktop]} gap-x-0.5 gap-y-6 md:gap-y-10`;
}

/** Kart görselinin ekrandaki genişliği; tarayıcı srcset'ten buna göre seçer. */
export function cardImageSizes(density: Density = DEFAULT_DENSITY): string {
  return `(min-width: 768px) ${density.desktop === 2 ? "50vw" : "25vw"}, ${density.mobile === 1 ? "100vw" : "50vw"}`;
}

export const CARD_IMAGE_SIZES = cardImageSizes(DEFAULT_DENSITY);
