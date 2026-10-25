import "server-only";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/server/auth/current";
import { getOrderForGuest, getOrderForUser } from "@/server/services/orders";

/*
  Misafir sipariş erişimi: sipariş oluşturulurken üretilen erişim token'ı yalnızca bu
  tarayıcıdaki httpOnly çerezde tutulur (veritabanında özeti var). Çerez en fazla son 5
  siparişi taşır; içerik sıkı biçimde ayrıştırılır, tutmayan her şey yok sayılır.
*/

const secure = process.env.NODE_ENV === "production";
// __Host- öneki: yalnızca HTTPS, alan adı paylaşımı yok, path=/ zorunlu
export const GUEST_ORDERS_COOKIE = secure ? "__Host-fd_siparisler" : "fd_siparisler";
const GUEST_ORDERS_MAX_AGE = 60 * 60 * 24 * 30;

export const MAX_GUEST_ORDERS = 5;
export const ORDER_NUMBER_RE = /^FD[A-Z2-9]{8}$/;

export type GuestOrderRef = { number: string; token: string };

// randomToken(): 32 bayt base64url → 43 karakter
const PAIR_RE = /^(FD[A-Z2-9]{8})\.([A-Za-z0-9_-]{43})$/;
const PAIR_SEPARATOR = "~";
// 5 çift × 54 karakter + ayraçlar ≈ 274; bundan çok uzun içerik zaten bizim yazdığımız değil
const MAX_RAW_LENGTH = 400;

const isRef = (r: GuestOrderRef) => PAIR_RE.test(`${r.number}.${r.token}`);

/** Çerez değerini ayrıştırır. Bozuk, uydurma ya da beklenmeyen içerikte boş liste döner. */
export function parseGuestOrders(raw: unknown): GuestOrderRef[] {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RAW_LENGTH) return [];
  const out: GuestOrderRef[] = [];
  for (const part of raw.split(PAIR_SEPARATOR)) {
    const m = PAIR_RE.exec(part);
    if (!m) continue;
    if (out.some((r) => r.number === m[1])) continue;
    out.push({ number: m[1]!, token: m[2]! });
    if (out.length === MAX_GUEST_ORDERS) break;
  }
  return out;
}

/** Listeyi çerez değerine çevirir; geçersiz kayıtlar yazılmaz, en fazla 5 kayıt. */
export function serializeGuestOrders(list: readonly GuestOrderRef[]): string {
  return list
    .filter(isRef)
    .slice(0, MAX_GUEST_ORDERS)
    .map((r) => `${r.number}.${r.token}`)
    .join(PAIR_SEPARATOR);
}

/** Yeni siparişi listenin başına ekler; aynı numara varsa yenisiyle değişir, en eskiler düşer. */
export function addGuestOrder(list: readonly GuestOrderRef[], ref: GuestOrderRef): GuestOrderRef[] {
  if (!isRef(ref)) return [...list];
  return [ref, ...list.filter((r) => r.number !== ref.number)].slice(0, MAX_GUEST_ORDERS);
}

async function readGuestOrders(): Promise<GuestOrderRef[]> {
  return parseGuestOrders((await cookies()).get(GUEST_ORDERS_COOKIE)?.value);
}

/** Yalnızca Server Action ve Route Handler içinde: misafir siparişinin erişim token'ını saklar. */
export async function rememberGuestOrder(number: string, token: string): Promise<void> {
  const next = addGuestOrder(await readGuestOrders(), { number, token });
  (await cookies()).set(GUEST_ORDERS_COOKIE, serializeGuestOrders(next), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_ORDERS_MAX_AGE,
  });
}

export async function getGuestOrderToken(number: string): Promise<string | null> {
  if (!ORDER_NUMBER_RE.test(number)) return null;
  return (await readGuestOrders()).find((r) => r.number === number)?.token ?? null;
}

/**
 * Bu isteğin görmeye yetkili olduğu sipariş: giriş yapan kullanıcının kendi siparişi ya da
 * bu tarayıcının misafir çerezindeki token'la eşleşen sipariş. Diğer her durumda null (IDOR yok).
 */
export async function getAccessibleOrder(number: string) {
  if (!ORDER_NUMBER_RE.test(number)) return null;
  const user = await getCurrentUser();
  if (user) {
    const own = await getOrderForUser(user.id, number);
    if (own) return own;
  }
  const token = await getGuestOrderToken(number);
  return token ? getOrderForGuest(number, token) : null;
}
