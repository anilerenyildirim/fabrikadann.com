import type { MarketplaceAttr } from "@/server/db/schema";
import { mediaJpegUrl } from "@/server/storage/images";
import type { N11Attribute, N11Sku } from "./client";

export type N11Settings = {
  n11PricePercent: number;
  n11PreparingDay: number;
  n11VatRate: number;
  n11ShipmentTemplate: string;
  n11Brand: string;
};

export type ListingInput = {
  product: {
    id: string;
    name: string;
    description: string;
    price: number;
    n11Price: number | null;
    colors: {
      name: string;
      /** Görsel depolama anahtarları, sıralı */
      images: string[];
      variants: { sku: string; size: string; stock: number; barcode: string | null }[];
    }[];
  };
  mapping: { externalCategoryId: number; attributes: MarketplaceAttr[] };
  /** Ürüne özel özellikler (AI Asistan ya da yönetici); aynı özellikte kategori eşlemesindekini ezer */
  productAttributes?: MarketplaceAttr[];
  /** Eşlenen N11 kategorisinin özellikleri (N11'den okunur) */
  attributes: N11Attribute[];
  settings: N11Settings;
  /** Ürün güvenliği (GPSR) alanları; boşsa gönderilmez */
  company: { name: string; address: string; email: string };
  appUrl: string;
  /** Verilirse yalnız bu stok kodları */
  only?: Set<string>;
};

export type ListingProblem = { stockCode: string | null; reason: string };

const MAX_IMAGES = 8;
const MAX_TITLE = 100;
const lower = (s: string) => s.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();

/** N11 fiyatı (kuruş): elle girilmişse o; yoksa site fiyatı × (1 + oran), tam liraya yukarı. */
export function n11PriceOf(sitePrice: number, override: number | null, percent: number): number {
  if (override !== null) return override;
  return Math.ceil((sitePrice * (100 + percent)) / 100 / 100) * 100;
}

/** N11 yalnızca ulusal barkodu kaydeder: geçerli EAN-13, mağaza içi aralık (2…) değil. */
export function isNationalBarcode(barcode: string | null): boolean {
  if (!barcode || !/^\d{13}$/.test(barcode) || barcode.startsWith("2")) return false;
  const d = barcode.split("").map(Number);
  const sum = d.slice(0, 12).reduce((s, n, i) => s + n * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === d[12];
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Düz metin açıklamayı N11'in istediği HTML'e çevirir (kullanıcı HTML'i hiçbir zaman geçmez). */
function descriptionHtml(text: string, fallback: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`);
  return paragraphs.length ? paragraphs.join("") : `<p>${escapeHtml(fallback)}</p>`;
}

function normSize(size: string) {
  return size.trim().replace(/^(\d{1,2}),(\d)$/, "$1.$2");
}

function byName(attrs: N11Attribute[], names: string[]) {
  const wanted = names.map(lower);
  return attrs.find((a) => wanted.includes(lower(a.name)));
}

/** Liste değerinde varsa valueId, serbest metne izin varsa customValue, yoksa null. */
function valueFor(attr: N11Attribute, value: string): { valueId: number | null; customValue: string | null } | null {
  const hit = attr.values.find((v) => lower(v.value) === lower(value));
  if (hit) return { valueId: hit.id, customValue: null };
  if (attr.custom) return { valueId: null, customValue: value };
  return null;
}

/**
 * Bir ürünün N11 SKU'ları: her renk × numara bir SKU, hepsi aynı productMainId (ürün kimliği) altında.
 * Gönderilemeyenler sorun olarak döner; ürün düzeyindeki sorunda (stockCode null) hiçbir SKU gönderilmez.
 */
export function buildSkus(input: ListingInput): { skus: N11Sku[]; problems: ListingProblem[] } {
  const { product, mapping, attributes, settings, company, appUrl } = input;
  const problems: ListingProblem[] = [];
  if (!appUrl.startsWith("https://")) problems.push({ stockCode: null, reason: "Görsel adresleri https olmalı (APP_URL)" });

  const brand = byName(attributes, ["Marka"]);
  const color = byName(attributes, ["Renk"]);
  const size = attributes.find((a) => a.variant && a.id !== color?.id) ?? byName(attributes, ["Numara", "Beden"]);
  const auto = new Set([brand?.id, color?.id, size?.id].filter((x): x is number => x !== undefined));

  // Kategoriye sabit özellikler (eşleştirmeden) + marka + ürün güvenliği alanları
  const own = input.productAttributes ?? [];
  const merged = [...mapping.attributes.filter((a) => !own.some((o) => o.id === a.id)), ...own];
  const fixed: N11Sku["attributes"] = merged
    .filter((a) => !auto.has(a.id) && attributes.some((x) => x.id === a.id))
    .map((a) => ({ id: a.id, valueId: a.valueId, customValue: a.valueId === null ? a.customValue : null }));
  if (brand) {
    const v = valueFor(brand, settings.n11Brand.trim() || "Fabrikadann");
    if (v) fixed.push({ id: brand.id, valueId: v.valueId, customValue: v.customValue });
    else problems.push({ stockCode: null, reason: `Marka "${settings.n11Brand}" N11 listesinde yok` });
  }
  const gpsr: [string, string][] = [
    ["Kayıtlı Ticari Unvan", company.name],
    ["İletişim Adresi", company.address],
    ["E-posta", company.email],
  ];
  const gpsrAttrs: N11Sku["attributes"] = [];
  for (const [name, value] of gpsr) {
    const a = byName(attributes, [name]);
    if (a?.custom && value.trim() && !fixed.some((f) => f.id === a.id)) gpsrAttrs.push({ id: a.id, valueId: null, customValue: value.trim().slice(0, 255) });
  }

  const missing = attributes.filter((a) => a.mandatory && !auto.has(a.id) && !fixed.some((f) => f.id === a.id));
  if (missing.length) problems.push({ stockCode: null, reason: `Kategori eşleştirmesinde zorunlu özellik eksik: ${missing.map((a) => a.name).join(", ")}` });

  const price = n11PriceOf(product.price, product.n11Price, settings.n11PricePercent);
  const description = descriptionHtml(product.description, product.name);
  const skus: N11Sku[] = [];

  for (const c of product.colors) {
    const variants = c.variants.filter((v) => !input.only || input.only.has(v.sku));
    if (variants.length === 0) continue;
    if (c.images.length === 0) {
      problems.push({ stockCode: null, reason: `${c.name} renginin görseli yok` });
      continue;
    }
    const colorValue = color ? valueFor(color, c.name) : null;
    if (color && !colorValue) {
      problems.push({ stockCode: null, reason: `${c.name} rengi N11 Renk listesinde yok` });
      continue;
    }
    const name = product.name.replace(/\s+/g, " ").trim();
    const title = (lower(name).includes(lower(c.name)) ? name : `${name} ${c.name}`).slice(0, MAX_TITLE).trim();
    const images = c.images.slice(0, MAX_IMAGES).map((key, order) => ({ url: `${appUrl.replace(/\/$/, "")}${mediaJpegUrl(key, 1200)}`, order }));

    for (const v of variants) {
      let sizeAttr: N11Sku["attributes"][number] | null = null;
      if (size) {
        const value = normSize(v.size);
        const hit = size.values.find((x) => normSize(x.value) === value);
        if (hit) sizeAttr = { id: size.id, valueId: hit.id, customValue: null };
        else if (size.custom) sizeAttr = { id: size.id, valueId: null, customValue: value };
        else {
          problems.push({ stockCode: v.sku, reason: `N11'de ${value} numarası yok (${size.name} listesi)` });
          continue;
        }
      }
      skus.push({
        title,
        description,
        categoryId: mapping.externalCategoryId,
        currencyType: "TL",
        productMainId: product.id,
        preparingDay: settings.n11PreparingDay,
        shipmentTemplate: settings.n11ShipmentTemplate.trim(),
        stockCode: v.sku,
        barcode: isNationalBarcode(v.barcode) ? v.barcode : null,
        quantity: Math.min(Math.max(v.stock, 0), 999999),
        images,
        attributes: [
          ...fixed,
          ...(color && colorValue ? [{ id: color.id, ...colorValue }] : []),
          ...(sizeAttr ? [sizeAttr] : []),
          ...gpsrAttrs,
        ],
        salePrice: price,
        listPrice: price,
        vatRate: settings.n11VatRate,
      });
    }
  }
  // Ürün düzeyinde sorun varsa hiçbir SKU gönderilmez (N11'de yarım ürün açılmasın)
  if (problems.some((p) => p.stockCode === null)) return { skus: [], problems };
  return { skus, problems };
}
