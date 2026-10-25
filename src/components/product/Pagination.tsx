import Link from "next/link";

const linkClass = "label inline-flex min-h-11 min-w-11 items-center justify-center px-2 hover:underline hover:underline-offset-4";

/** Önceki / sonraki sayfa. Tek sayfa varsa hiçbir şey göstermez. */
export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (page: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Sayfalar" className="mt-14 flex items-center justify-center gap-4 px-4">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={linkClass}>
          Önceki sayfa
        </Link>
      ) : (
        <span className={`${linkClass} text-ash hover:no-underline`} aria-hidden="true">
          Önceki sayfa
        </span>
      )}
      <span className="label tabular text-graphite">
        <span className="sr-only">Sayfa </span>
        {page} / {pages}
      </span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} rel="next" className={linkClass}>
          Sonraki sayfa
        </Link>
      ) : (
        <span className={`${linkClass} text-ash hover:no-underline`} aria-hidden="true">
          Sonraki sayfa
        </span>
      )}
    </nav>
  );
}
