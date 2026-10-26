import Link from "next/link";
import type { ReactNode } from "react";
import type { OrderStatus } from "@/server/services/orders";
import { ORDER_STATUS_LABELS } from "@/server/services/orders";

/** Sayfa başlığı: geniş başlık, isteğe bağlı açıklama ve sağda eylemler. */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 md:mb-10 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href}
            className="label -ml-0.5 mb-2 inline-flex min-h-11 items-center gap-2 text-graphite hover:text-ink"
          >
            <span aria-hidden="true">←</span> {back.label}
          </Link>
        )}
        <h1 className="wide text-base leading-snug break-words md:text-lg">{title}</h1>
        {description && <div className="mt-2 max-w-2xl text-[0.8125rem] text-graphite">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

/** İnce çizgiyle ayrılmış bölüm. */
export function Section({
  title,
  description,
  id,
  children,
  actions,
}: {
  title: string;
  description?: ReactNode;
  id?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-baslik` : undefined} className="scroll-mt-28 border-t border-rule pt-6 pb-10">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id={id ? `${id}-baslik` : undefined} className="label">
            {title}
          </h2>
          {description && <div className="mt-1 max-w-2xl text-[0.8125rem] text-graphite">{description}</div>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

// İstemci bileşenleri de kullanır: sunucu modülü içe aktarmayan ayrı dosyada
export { table, TableWrap, td, th } from "./table";

export function OrderStatusTag({ status }: { status: OrderStatus }) {
  // Gri metin graphite: ash beyaz zeminde küçük yazı için yeterli kontrast vermiyor
  const style: Record<OrderStatus, string> = {
    awaiting_payment: "border border-dashed border-ash text-graphite",
    preparing: "bg-ink text-paper",
    shipped: "border border-ink",
    delivered: "border border-rule text-graphite",
    cancelled: "text-graphite line-through decoration-1",
    refunded: "bg-fog text-graphite",
  };
  return <span className={`label inline-flex whitespace-nowrap px-2 py-1 ${style[status]}`}>{ORDER_STATUS_LABELS[status]}</span>;
}

export function ProductStatusTag({ status }: { status: "draft" | "active" | "archived" }) {
  const map = {
    draft: ["Taslak", "border border-dashed border-ash text-graphite"],
    active: ["Yayında", "border border-ink"],
    archived: ["Arşivde", "bg-fog text-graphite"],
  } as const;
  const [label, cls] = map[status];
  return <span className={`label inline-flex whitespace-nowrap px-2 py-1 ${cls}`}>{label}</span>;
}

/** Pano sayısı: büyük rakam, küçük etiket. */
export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <span className="label text-graphite">{label}</span>
      <span className="tabular mt-3 block text-xl leading-tight [overflow-wrap:anywhere] md:text-3xl md:leading-none">{value}</span>
      {hint && <span className="mt-2 block text-[0.75rem] text-graphite">{hint}</span>}
    </>
  );
  const cls = "block border-t border-ink pt-3 pb-4";
  return href ? (
    <Link href={href} className={`${cls} min-h-11 hover:bg-fog`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="border-t border-rule py-8 text-[0.8125rem] text-graphite">{children}</p>;
}

/** Durum gibi tek seçimli süzgeçler: bağlantı listesi (JS gerekmez). */
export function FilterLinks({
  items,
  current,
  label,
}: {
  items: { value: string; label: string; href: string; count?: number }[];
  current: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="rail -mx-4 mb-4 gap-1 px-4 md:mx-0 md:flex-wrap md:px-0">
      {items.map((i) => {
        const active = i.value === current;
        return (
          <Link
            key={i.value}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`label inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap px-3 ${
              active ? "bg-ink text-paper" : "text-graphite hover:text-ink"
            }`}
          >
            {i.label}
            {i.count !== undefined && <span className="tabular">{i.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** GET arama formu; JS olmadan da çalışır. */
export function SearchForm({
  action,
  q,
  placeholder,
  hidden = {},
  label = "Ara",
}: {
  action: string;
  q?: string;
  placeholder: string;
  hidden?: Record<string, string | undefined>;
  label?: string;
}) {
  return (
    <form action={action} method="get" role="search" className="mb-4 flex items-end gap-3">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="flex min-w-0 flex-1 flex-col">
        <label htmlFor="ara-q" className="label text-graphite">
          {label}
        </label>
        <input
          id="ara-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={placeholder}
          maxLength={100}
          autoComplete="off"
          className="min-h-11 border-0 border-b border-ash bg-transparent px-0 py-2 outline-none placeholder:text-ash focus:border-ink focus:shadow-[0_1px_0_0_var(--color-ink)]"
        />
      </div>
      <button type="submit" className="label min-h-11 border border-ink px-4 hover:bg-fog">
        Ara
      </button>
    </form>
  );
}

/** Sayfalama: önceki / sonraki. */
export function Pager({
  page,
  pageCount,
  hrefFor,
  total,
  unit,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  total: number;
  unit: string;
}) {
  if (pageCount <= 1) return <p className="label mt-4 text-graphite">{total} {unit}</p>;
  return (
    <nav aria-label="Sayfalar" className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <p className="label text-graphite">
        {total} {unit} · sayfa {page} / {pageCount}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className="label inline-flex min-h-11 items-center border border-ink px-4 hover:bg-fog" rel="prev">
            Önceki
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className="label inline-flex min-h-11 items-center border border-ink px-4 hover:bg-fog" rel="next">
            Sonraki
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

const dateTime = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateTime.format(new Date(d));
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateOnly.format(new Date(d));
}

/** URL arama parametresinden tek değer (dizi gelirse ilki), uzunluk sınırlı. */
export function param(value: string | string[] | undefined, max = 100): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v ? v.slice(0, max) : undefined;
}

export function pageParam(value: string | string[] | undefined): number {
  const n = Number.parseInt(param(value, 6) ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Sorgu dizesi üretir; boş değerler atlanır. */
export function qs(base: string, params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}
