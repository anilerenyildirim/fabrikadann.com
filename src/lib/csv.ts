// Türkçe Excel için CSV: noktalı virgülle ayrılır, UTF-8 BOM ile başlar.

const BOM = "﻿";

/** Formül enjeksiyonunu önler (=, +, -, @ ile başlayan metin hücresi) ve gerekiyorsa tırnaklar. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Sayı biçimindeki metin ("-12,50") formül değildir
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return BOM + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

/** Kuruşu Excel'in Türkçe ayarında sayı olarak okunan "1234,50" biçimine çevirir. */
export function csvMoney(kurus: number): string {
  const sign = kurus < 0 ? "-" : "";
  const abs = Math.abs(kurus);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
