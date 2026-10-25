const formatter = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Kuruş cinsinden tutarı "1.299,90 TL" olarak biçimlendirir. */
export function formatPrice(kurus: number): string {
  return `${formatter.format(kurus / 100)} TL`;
}

/** "1.299,90" gibi bir girdiyi kuruşa çevirir; geçersiz ya da negatifse NaN. */
export function parsePriceToKurus(input: string): number {
  const cleaned = input.replace(/TL|₺/gi, "").trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(cleaned)) return Number.NaN;
  const [whole, frac = ""] = cleaned.replace(/\./g, "").split(",");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
