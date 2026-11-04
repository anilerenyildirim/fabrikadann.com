import { stripControl } from "@/lib/text";
import type { FetchLike, TrendyolApprovedContent, TrendyolAttribute } from "./client";

/**
 * Trendyol ürünlerinin siteye aktarımı için saf yardımcılar: gruplama, numara/renk okuma, HTML → düz metin,
 * indirimli fiyat ve görsel indirme (yalnızca Trendyol CDN'i).
 */

export const DEFAULT_TRENDYOL_DISCOUNT = 25;
export const MAX_TRENDYOL_DISCOUNT = 90;

/**
 * Site fiyatı = Trendyol satış fiyatı − %indirim, en yakın tam liraya yuvarlanır (ör. 1.299,99 TL −%25 → 975 TL).
 * En az 1 TL.
 */
export function discountedPrice(trendyolPrice: number, discountPercent: number): number {
  if (!Number.isInteger(trendyolPrice) || trendyolPrice <= 0) throw new Error("Geçersiz Trendyol fiyatı");
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > MAX_TRENDYOL_DISCOUNT) {
    throw new Error("Geçersiz indirim oranı");
  }
  const raw = (trendyolPrice * (100 - discountPercent)) / 100;
  return Math.max(100, Math.round(raw / 100) * 100);
}

// ---------- HTML → düz metin ----------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  middot: "·",
  deg: "°",
  times: "×",
  euro: "€",
  ccedil: "ç",
  Ccedil: "Ç",
  ouml: "ö",
  Ouml: "Ö",
  uuml: "ü",
  Uuml: "Ü",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

/**
 * Trendyol açıklaması (HTML) → düz metin. Etiketler atılır (script/style içeriğiyle), blok sonları satır olur,
 * varlıklar çözülür. Sonuç hiçbir zaman HTML olarak gösterilmez; vitrin düz metin basar.
 */
export function htmlToText(html: string, max = 5000): string {
  let s = html.slice(0, 200_000);
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<li[^>]*>/gi, "\n- ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|table|section)\s*>/gi, "\n");
  s = s.replace(/<[^>]*>/g, " ");
  // Kalan yarım etiket ("<b" gibi) da metne sızmasın
  s = s.replace(/</g, " ").replace(/>/g, " ");
  s = decodeEntities(s);
  s = stripControl(s).replace(/\r/g, "");
  const lines = s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l) => l !== "");
  const text = lines.join("\n");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// ---------- Numara ve renk ----------

const SIZE_NAMES = ["beden", "numara", "ayakkabı numarası", "ayak numarası", "size"];
const COLOR_NAMES = ["renk", "web color", "color"];

const norm = (s: string | null | undefined) => (s ?? "").trim().toLocaleLowerCase("tr-TR");

function attr(attrs: TrendyolAttribute[], names: string[]): string | null {
  for (const name of names) {
    const hit = attrs.find((a) => norm(a.attributeName) === name && a.attributeValue && a.attributeValue.trim());
    if (hit) return hit.attributeValue!.trim();
  }
  return null;
}

/** Numara: "38,5" → "38.5"; boşluklar sadeleşir; en fazla 20 karakter. Yoksa null. */
export function sizeOf(attrs: TrendyolAttribute[]): string | null {
  const raw = attr(attrs, SIZE_NAMES);
  if (!raw) return null;
  const s = stripControl(raw)
    .replace(/^(\d{1,2}),(\d)$/, "$1.$2")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
  return s || null;
}

export function colorOf(content: TrendyolApprovedContent): string {
  const raw = attr(content.attributes, COLOR_NAMES) ?? content.variants.map((v) => attr(v.attributes, COLOR_NAMES)).find(Boolean) ?? null;
  const s = stripControl(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return s || "Standart";
}

// ---------- Gruplama ----------

export type ImportItem = { barcode: string; size: string; quantity: number; salePrice: number | null; onSale: boolean };
export type ImportColor = { name: string; images: string[]; items: ImportItem[] };
export type ImportProblem = { barcode: string; reason: string };

export type ImportGroup = {
  productMainId: string;
  name: string;
  description: string;
  categoryName: string | null;
  brandName: string | null;
  colors: ImportColor[];
  /** Satıştaki numaraların en düşük satış fiyatı (yoksa tüm numaraların), kuruş */
  trendyolPrice: number | null;
  /** Aktarılamayacak numaralar (numarası yok, aynı renk+numara iki kez …) */
  problems: ImportProblem[];
};

/**
 * Trendyol içeriklerini productMainId'ye göre birleştirir: her grup bir site ürünü, her içerik (aynı adlı renkler
 * birleşerek) bir renk, her numara bir beden. Arşivlenmiş/kara listedeki numaralar alınmaz.
 */
export function groupContents(contents: TrendyolApprovedContent[]): ImportGroup[] {
  const groups = new Map<string, ImportGroup>();
  for (const c of contents) {
    let g = groups.get(c.productMainId);
    if (!g) {
      g = {
        productMainId: c.productMainId,
        name: stripControl(c.title).replace(/\s+/g, " ").trim().slice(0, 120) || c.productMainId.slice(0, 120),
        description: htmlToText(c.description),
        categoryName: c.categoryName ? stripControl(c.categoryName).replace(/\s+/g, " ").trim().slice(0, 60) || null : null,
        brandName: c.brandName,
        colors: [],
        trendyolPrice: null,
        problems: [],
      };
      groups.set(c.productMainId, g);
    }
    const name = colorOf(c);
    let color = g.colors.find((x) => norm(x.name) === norm(name));
    if (!color) {
      color = { name, images: [], items: [] };
      g.colors.push(color);
    }
    for (const url of c.images) if (!color.images.includes(url)) color.images.push(url);

    const live = c.variants.filter((v) => !v.archived);
    for (const v of live) {
      if (g.colors.some((col) => col.items.some((i) => i.barcode === v.barcode)) || g.problems.some((p) => p.barcode === v.barcode)) {
        continue;
      }
      // Tek numaralı içerikte numara yazılmamışsa "Standart"; çok numaralıda hangisi olduğu bilinemez
      const size = sizeOf(v.attributes) ?? (live.length === 1 ? "Standart" : null);
      if (!size) {
        g.problems.push({ barcode: v.barcode, reason: "Trendyol'da numara (Beden) bilgisi yok" });
        continue;
      }
      if (color.items.some((i) => i.size === size)) {
        g.problems.push({ barcode: v.barcode, reason: `${name} renginde ${size} numarası iki kez var` });
        continue;
      }
      color.items.push({ barcode: v.barcode, size, quantity: v.quantity, salePrice: v.salePrice, onSale: v.onSale });
    }
  }
  for (const g of groups.values()) {
    g.colors = g.colors.filter((c) => c.items.length > 0);
    const items = g.colors.flatMap((c) => c.items);
    const pick = (list: ImportItem[]) =>
      list.reduce<number | null>((m, i) => (i.salePrice && (m === null || i.salePrice < m) ? i.salePrice : m), null);
    g.trendyolPrice = pick(items.filter((i) => i.onSale)) ?? pick(items);
  }
  return [...groups.values()];
}

// ---------- Görsel indirme ----------

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 15_000;

/** Yalnızca Trendyol'un görsel CDN'i (https, *.dsmcdn.com, varsayılan port, kullanıcı bilgisi yok). */
export function isAllowedImageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  return host === "dsmcdn.com" || host.endsWith(".dsmcdn.com");
}

export class ImageFetchError extends Error {}

/** Görseli indirir (yönlendirme yok, süre ve boyut sınırlı). Doğrulama ve yeniden kodlama storeProductImage'da. */
export async function fetchTrendyolImage(url: string, fetchImpl: FetchLike = fetch): Promise<Buffer> {
  if (!isAllowedImageUrl(url)) throw new ImageFetchError("Görsel adresi Trendyol'a ait değil");
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
  } catch {
    throw new ImageFetchError("Görsel indirilemedi");
  }
  if (!res.ok) throw new ImageFetchError(`Görsel indirilemedi (${res.status})`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) throw new ImageFetchError("Görsel 10 MB'tan büyük");
  if (!res.body) throw new ImageFetchError("Görsel boş");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) throw new ImageFetchError("Görsel 10 MB'tan büyük");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    if (e instanceof ImageFetchError) throw e;
    throw new ImageFetchError("Görsel indirilemedi");
  }
  return Buffer.concat(chunks);
}
