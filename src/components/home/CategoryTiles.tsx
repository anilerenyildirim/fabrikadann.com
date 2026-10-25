import Link from "next/link";
import { ProductImage } from "@/components/ui/ProductImage";
import type { ImageRef } from "@/server/services/catalog";

export type CategoryTile = { name: string; slug: string; image: ImageRef | null };

/** Kategori kutuları: mobilde tek, masaüstünde iki sütun; tek kalan son kutu tam genişlik. */
export function CategoryTiles({ tiles }: { tiles: CategoryTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <section aria-labelledby="kategoriler-baslik">
      <h2 id="kategoriler-baslik" className="sr-only">
        Kategoriler
      </h2>
      <ul className="grid gap-0.5 md:grid-cols-2">
        {tiles.map((tile, i) => {
          const wide = tiles.length % 2 === 1 && i === tiles.length - 1;
          return (
            <li key={tile.slug} className={wide ? "md:col-span-2" : ""}>
              <Link href={`/kategori/${tile.slug}`} className="relative block focus-visible:outline-offset-[-3px]">
                <div className={`aspect-[4/5] overflow-hidden bg-fog ${wide ? "md:aspect-[2/1]" : ""}`}>
                  <ProductImage
                    image={tile.image && { ...tile.image, alt: "" }}
                    ratio="auto"
                    sizes={wide ? "100vw" : "(min-width: 768px) 50vw, 100vw"}
                    className="h-full w-full"
                  />
                </div>
                <span className="wide absolute inset-x-4 top-4 break-words text-[0.9375rem] md:inset-x-6 md:top-6 md:text-base">
                  {tile.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
