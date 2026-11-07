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

const cleanColor = (raw: string | null) => stripControl(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || null;

/** Rengin adı: satıcının yazdığı "Renk", yoksa Trendyol'un standart "Web Color"ı. */
function colorName(attrs: TrendyolAttribute[]): string | null {
  return cleanColor(attr(attrs, ["renk", "color"])) ?? cleanColor(attr(attrs, ["web color"]));
}

export function colorOf(content: TrendyolApprovedContent): string {
  return colorName(content.attributes) ?? content.variants.map((v) => colorName(v.attributes)).find(Boolean) ?? "Standart";
}

// ---------- Gruplama ----------

export type ImportItem = { barcode: string; size: string; quantity: number; salePrice: number | null; onSale: boolean };
export type ImportColor = {
  /**
   * Trendyol'daki renk kartı: içerik kimliği (contentId). Trendyol'da her renk ayrı içeriktir; aynı adlı
   * (ör. ikisi de "Siyah") iki kart yine iki ayrı renktir. İçerikte numaralar farklı renkteyse "içerik|renk".
   */
  key: string;
  name: string;
  /** Ayırt edici ad verilmeden önceki ad (Trendyol'daki "Renk") */
  sourceName: string;
  images: string[];
  items: ImportItem[];
};
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

const byContentId = (a: TrendyolApprovedContent, b: TrendyolApprovedContent) => {
  const x = Number(a.contentId);
  const y = Number(b.contentId);
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  return (a.contentId ?? "").localeCompare(b.contentId ?? "");
};

/**
 * Trendyol içeriklerini productMainId'ye göre birleştirir: her grup bir site ürünü, her içerik (renk kartı) bir renk,
 * her numara bir beden. Renkler adına göre değil içerik kimliğine göre ayrılır; aynı adı taşıyan kartlar
 * "Siyah (Kahverengi)" ya da "Siyah 2" gibi ayırt edilir. Arşivlenmiş/kara listedeki numaralar alınmaz.
 */
export function groupContents(contents: TrendyolApprovedContent[]): ImportGroup[] {
  const groups = new Map<string, ImportGroup>();
  const byMain = new Map<string, TrendyolApprovedContent[]>();
  for (const c of contents) {
    const list = byMain.get(c.productMainId) ?? [];
    list.push(c);
    byMain.set(c.productMainId, list);
  }
  for (const [mainId, list] of byMain) {
    // Sıra sabit olsun: aynı adlı kartların hangisinin "2" olacağı her okumada aynı
    list.sort(byContentId);
    const first = list[0]!;
    const g: ImportGroup = {
      productMainId: mainId,
      name: stripControl(first.title).replace(/\s+/g, " ").trim().slice(0, 120) || mainId.slice(0, 120),
      description: htmlToText(first.description),
      categoryName: first.categoryName ? stripControl(first.categoryName).replace(/\s+/g, " ").trim().slice(0, 60) || null : null,
      brandName: first.brandName,
      colors: [],
      trendyolPrice: null,
      problems: [],
    };
    groups.set(mainId, g);
    const webColor = new Map<string, string | null>();
    const seen = new Set<string>();

    for (const [index, c] of list.entries()) {
      const contentName = colorOf(c);
      const contentKey = c.contentId ?? `sira-${index}`;
      const live = c.variants.filter((v) => !v.archived);
      // İçerikteki numaralar farklı renk taşıyorsa (alışılmadık ama mümkün) her renk ayrı
      const variantNames = new Set(live.map((v) => norm(colorName(v.attributes) ?? contentName)));
      for (const v of live) {
        if (seen.has(v.barcode)) continue;
        seen.add(v.barcode);
        const name = (variantNames.size > 1 ? colorName(v.attributes) : null) ?? contentName;
        const key = variantNames.size > 1 ? `${contentKey}|${norm(name)}` : contentKey;
        let color = g.colors.find((x) => x.key === key);
        if (!color) {
          color = { key, name, sourceName: name, images: [], items: [] };
          for (const url of c.images) if (!color.images.includes(url)) color.images.push(url);
          g.colors.push(color);
          webColor.set(key, cleanColor(attr(v.attributes, ["web color"])) ?? cleanColor(attr(c.attributes, ["web color"])));
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
    g.colors = g.colors.filter((c) => c.items.length > 0);
    distinctNames(g.colors, webColor);
    const items = g.colors.flatMap((c) => c.items);
    const pick = (l: ImportItem[]) =>
      l.reduce<number | null>((m, i) => (i.salePrice && (m === null || i.salePrice < m) ? i.salePrice : m), null);
    g.trendyolPrice = pick(items.filter((i) => i.onSale)) ?? pick(items);
  }
  return [...groups.values()];
}

/** Aynı adı taşıyan renk kartlarına ayırt edici ad verir (ilk kart adını korur). */
function distinctNames(colors: ImportColor[], webColor: Map<string, string | null>) {
  const count = new Map<string, number>();
  for (const c of colors) count.set(norm(c.name), (count.get(norm(c.name)) ?? 0) + 1);
  const used = new Set<string>();
  for (const c of colors) {
    const base = c.name;
    if (count.get(norm(base))! > 1 && used.has(norm(base))) {
      const web = webColor.get(c.key);
      let candidate = web && norm(web) !== norm(base) ? `${base} (${web})`.slice(0, 40) : null;
      for (let n = 2; !candidate || used.has(norm(candidate)) || (count.get(norm(candidate)) ?? 0) > 0; n++) {
        candidate = `${base.slice(0, 36)} ${n}`;
      }
      c.name = candidate;
    }
    used.add(norm(c.name));
  }
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
