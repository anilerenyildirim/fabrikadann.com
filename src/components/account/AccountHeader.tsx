import Link from "next/link";
import type { ReactNode } from "react";

/** Hesap ve giriş sayfalarının başlığı; alt sayfalarda "Hesabım"a dönüş bağlantısı. */
export function AccountHeader({
  title,
  back = false,
  children,
}: {
  title: string;
  back?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="mb-10 md:mb-12">
      {back && (
        <Link
          href="/hesabim"
          className="label -ml-1 mb-4 inline-flex min-h-11 items-center gap-2 px-1 text-graphite hover:text-ink"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
            <path d="M10 3L5 8l5 5" />
          </svg>
          Hesabım
        </Link>
      )}
      <h1 className="wide text-lg font-[350] md:text-xl">{title}</h1>
      {children && <div className="mt-3 max-w-xl text-graphite">{children}</div>}
    </header>
  );
}
