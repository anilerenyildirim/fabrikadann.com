import { formatPrice } from "@/lib/money";
import type { Settings } from "@/server/services/settings";

/**
 * Yasal metinlerdeki kargo koşulu. Kural sepet hesabıyla (computeShipping) aynı: ücret 0 ya da
 * eşik 0 ise her sipariş ücretsiz, değilse eşik ve üzeri ücretsiz.
 */
export function shippingTerms(s: Pick<Settings, "shippingFee" | "freeShippingThreshold">): string {
  if (s.shippingFee === 0 || s.freeShippingThreshold === 0) return "Kargo ücretsizdir.";
  return `Kargo ücreti ${formatPrice(s.shippingFee)}’dir; ${formatPrice(s.freeShippingThreshold)} ve üzerindeki siparişlerde kargo ücretsizdir.`;
}

/** Boş ayar için sayfada görünür yer tutucu: işletme panelden doldurana kadar eksik olduğu belli olsun. */
export function placeholder(what: string): string {
  return `[${what} — yönetim panelinde Ayarlar'dan girilecek]`;
}

export type CompanyInfo = {
  name: string;
  address: string;
  taxOffice: string;
  taxNumber: string;
  mersis: string;
  email: string;
  phone: string;
  kep: string;
};

/** Yasal metinlerde kullanılan şirket bilgileri; boş olanlar yer tutucuyla. */
export function companyInfo(s: Settings): CompanyInfo {
  const pick = (value: string, what: string) => value.trim() || placeholder(what);
  return {
    name: pick(s.companyName, "Şirket unvanı"),
    address: pick(s.companyAddress, "Şirket adresi"),
    taxOffice: pick(s.taxOffice, "Vergi dairesi"),
    taxNumber: pick(s.taxNumber, "Vergi numarası"),
    mersis: pick(s.mersisNumber, "MERSİS numarası"),
    email: pick(s.email, "E-posta adresi"),
    phone: pick(s.phone, "Telefon numarası"),
    kep: pick(s.kepAddress, "KEP adresi"),
  };
}

/** Değer yer tutucu değilse true (bağlantı vermek için: mailto/tel). */
export function isFilled(value: string): boolean {
  return !value.startsWith("[");
}

/** tel: bağlantısı için yalnızca rakam ve baştaki +. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
