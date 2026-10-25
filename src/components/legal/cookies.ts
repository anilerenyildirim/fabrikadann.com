/** Çerez bildiriminin kapatıldığını hatırlayan yerel depolama anahtarı (çerez değil, sunucuya gitmez). */
export const COOKIE_NOTICE_KEY = "fd_cerez_bildirimi";

/** Çerez politikasında listelenen yerel depolama kayıtları; anahtarlar koddakilerle aynı tutulmalı. */
export const LOCAL_STORAGE_ITEMS = [
  { key: COOKIE_NOTICE_KEY, purpose: "Çerez bildirimini kapattığınızı hatırlar." },
  { key: "fd_izgara", purpose: "Ürün listesinde seçtiğiniz görünümü (sütun sayısı) hatırlar." },
] as const;
