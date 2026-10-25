import { listingHref, type SortParam } from "@/lib/listing";
import { FilterPanel } from "./FilterPanel";
import { DensityToggle } from "./GridDensity";

/** Başlığın altında yapışkan çubuk: filtre/sıralama paneli ve ızgara yoğunluğu. */
export function FilterBar({
  path,
  sizes,
  selectedSizes,
  sort,
}: {
  path: string;
  sizes: string[];
  selectedSizes: string[];
  sort: SortParam;
}) {
  // Parametreler değişince panel yeniden kurulur: kapanır ve seçimler URL'yle eşleşir
  const stateKey = listingHref(path, { sizes: selectedSizes, sort });
  return (
    <div className="sticky top-14 z-30 border-b border-rule bg-paper md:top-16">
      <div className="flex min-h-12 items-center justify-between gap-2 px-2 md:px-4">
        <FilterPanel
          key={stateKey}
          action={path}
          sizes={sizes}
          selectedSizes={selectedSizes}
          sort={sort}
          clearHref={path}
        />
        <DensityToggle />
      </div>
    </div>
  );
}
