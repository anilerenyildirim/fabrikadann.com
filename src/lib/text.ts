export const trLower = (s: string) => s.toLocaleLowerCase("tr-TR");
export const trUpper = (s: string) => s.toLocaleUpperCase("tr-TR");

// Satır sonu (\n, \r) ve sekme dışındaki kontrol karakterleri; NUL Postgres'te hataya yol açar
const CONTROL_CHARS = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]", "g");

/** Kullanıcı metninden görünmez kontrol karakterlerini atar. */
export const stripControl = (s: string) => s.replace(CONTROL_CHARS, "");
