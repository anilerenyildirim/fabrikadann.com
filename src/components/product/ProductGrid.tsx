import type { ProductCard as ProductCardData } from "@/server/services/catalog";
import { DensityGrid } from "./GridDensity";
import { ProductCard } from "./ProductCard";
import { gridClass } from "./grid";

type Props = {
  products: ProductCardData[];
  /** İlk kaç kartın görseli öncelikli yüklensin (ekranın üstündekiler) */
  priorityCount?: number;
  /** Ziyaretçinin seçtiği yoğunluğu kullan (listeleme sayfaları) */
  adjustable?: boolean;
  label?: string;
};

export function ProductGrid({ products, priorityCount = 0, adjustable = false, label }: Props) {
  const items = products.map((p, i) => (
    <li key={p.id}>
      <ProductCard product={p} priority={i < priorityCount} />
    </li>
  ));
  if (adjustable) return <DensityGrid label={label}>{items}</DensityGrid>;
  return (
    <ul className={gridClass()} aria-label={label}>
      {items}
    </ul>
  );
}
