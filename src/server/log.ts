/**
 * Sunucu hata kaydı. Drizzle'ın sorgu hatası (DrizzleQueryError) mesajında sorgunun TÜM parametreleri
 * bulunur — e-posta, adres, telefon, parola özeti loglara düşmesin diye yalnızca veritabanının kendi
 * hata mesajı ve kodu yazılır.
 */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e).slice(0, 500);
  const isQueryError = e.name === "DrizzleQueryError" || "params" in e || /^Failed query:/.test(e.message);
  if (isQueryError) {
    const cause = (e as { cause?: unknown }).cause;
    const code = (cause as { code?: string } | undefined)?.code;
    const msg = cause instanceof Error ? cause.message : "ayrıntı yok";
    return `Veritabanı hatası: ${msg}${code ? ` (${code})` : ""}`;
  }
  const stack = e.stack?.split("\n").slice(1, 6).join("\n") ?? "";
  return `${e.name}: ${e.message}${stack ? `\n${stack}` : ""}`;
}

export function logError(tag: string, e: unknown): void {
  console.error(tag, describeError(e));
}
