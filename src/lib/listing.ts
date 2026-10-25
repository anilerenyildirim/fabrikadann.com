import { stripControl } from "./text";

/**
 * Vitrin listeleme sayfalarının (tümü, kategori, arama) URL parametreleri.
 * Saf fonksiyonlar: geçersiz değerler hata vermez, yok sayılır.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

/** URL'deki Türkçe sıralama adı → katalog servisinin sıralama anahtarı */
export const SORTS = {
  yeni: "new",
  artan: "price_asc",
  azalan: "price_desc",
} as const;

export type SortParam = keyof typeof SORTS;
export type ServiceSort = (typeof SORTS)[SortParam];

export const SORT_LABELS: Record<SortParam, string> = {
  yeni: "Yeni gelenler",
  artan: "Fiyat: düşükten yükseğe",
  azalan: "Fiyat: yüksekten düşüğe",
};

export const DEFAULT_SORT: SortParam = "yeni";
export const MAX_SIZES = 20;
export const MAX_PAGE = 1000;
export const MAX_QUERY_LENGTH = 80;

export type ListingQuery = {
  /** Seçili numaralar (?numara=40&numara=41) */
  sizes: string[];
  sort: SortParam;
  page: number;
  /** Arama metni (?q=) */
  q: string;
};

// Ayakkabı numarası: "40", "40.5", "40,5"
const SIZE_RE = /^\d{1,2}(?:[.,]\d)?$/;
const PAGE_RE = /^\d{1,4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function all(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isSortParam(value: unknown): value is SortParam {
  return typeof value === "string" && Object.hasOwn(SORTS, value);
}

export function parseListingParams(params: SearchParams): ListingQuery {
  const sizes: string[] = [];
  for (const raw of all(params.numara)) {
    const size = raw.trim();
    if (SIZE_RE.test(size) && !sizes.includes(size)) sizes.push(size);
    if (sizes.length === MAX_SIZES) break;
  }

  const sortRaw = first(params.sirala);
  const sort = isSortParam(sortRaw) ? sortRaw : DEFAULT_SORT;

  const pageRaw = first(params.sayfa)?.trim();
  const pageNum = pageRaw && PAGE_RE.test(pageRaw) ? Number(pageRaw) : 1;
  const page = pageNum >= 1 && pageNum <= MAX_PAGE ? pageNum : 1;

  // NUL vb. kontrol karakterleri Postgres'te hataya yol açar
  const q = stripControl(first(params.q) ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH).trim();

  return { sizes, sort, page, q };
}

/** Parametreleri URL'ye geri yazar; varsayılan değerler yazılmaz. */
export function listingHref(path: string, query: Partial<ListingQuery> = {}): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  for (const size of query.sizes ?? []) params.append("numara", size);
  if (query.sort && query.sort !== DEFAULT_SORT) params.set("sirala", query.sort);
  if (query.page && query.page > 1) params.set("sayfa", String(query.page));
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return first(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Ürün ve kategori adresleri yalnızca slugify çıktısı biçiminde olabilir. */
export function isSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= 120 && SLUG_RE.test(value);
}
