import "server-only";
import { isIP } from "node:net";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { deleteSession, validateSessionToken, type ValidSession } from "./session";

const secure = process.env.NODE_ENV === "production";
// __Host- öneki: yalnızca HTTPS, alan adı paylaşımı yok, path=/ zorunlu
export const SESSION_COOKIE = secure ? "__Host-fd_oturum" : "fd_oturum";

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export const getSession = cache(async (): Promise<ValidSession | null> => {
  const token = await readSessionToken();
  return token ? validateSessionToken(token) : null;
});

/**
 * Vitrin açısından giriş yapmış kullanıcı. İki adımlı doğrulamayı tamamlamamış yönetici oturumu
 * (yalnızca parola girilmiş) hiçbir yerde giriş yapmış sayılmaz.
 */
export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  if (session.user.role === "admin" && !session.secondFactor) return null;
  return session.user;
}

export async function signOut() {
  const token = await readSessionToken();
  if (token) await deleteSession(token);
  // __Host- çerezi yalnızca Secure özniteliğiyle silinebilir
  (await cookies()).delete({ name: SESSION_COOKIE, path: "/", secure, httpOnly: true, sameSite: "lax" });
}

/** Giriş yapılmamışsa giriş sayfasına yönlendirir. */
export async function requireUser(returnTo = "/hesabim") {
  const user = await getCurrentUser();
  if (!user) redirect(`/giris?sonra=${encodeURIComponent(returnTo)}`);
  return user;
}

/** Yalnızca rolü admin olan ve iki adımlı doğrulamayı geçmiş oturumlar. */
export async function requireAdmin() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") redirect("/yonetim/giris");
  if (!session.secondFactor) redirect("/yonetim/iki-adim");
  return session.user;
}

/**
 * İstemcinin IP adresi. Ters vekil (Caddy/Nginx/Cloudflare) arkasında çalışırken
 * CLIENT_IP_HEADER ile vekilin yazdığı başlık seçilir; varsayılan X-Forwarded-For'un
 * en sağdaki değeri (bizim vekilimizin eklediği, istemcinin uyduramayacağı değer).
 */
let warnedMissingIpHeader = false;

async function rawClientIp(): Promise<string | null> {
  const h = await headers();
  // Canlıda varsayılan, ters vekilin (Caddy) yazdığı X-Real-IP; X-Forwarded-For istemci tarafından uydurulabilir
  const name =
    process.env.CLIENT_IP_HEADER?.toLowerCase() ||
    (process.env.NODE_ENV === "production" ? "x-real-ip" : "x-forwarded-for");
  const raw = h.get(name);
  if (!raw) {
    // Canlıda başlık yoksa uygulama Caddy arkasında çalışmıyor demektir: tüm istekler tek kovaya düşer
    if (process.env.NODE_ENV === "production" && !warnedMissingIpHeader) {
      warnedMissingIpHeader = true;
      console.error(`[güvenlik] İstemci IP başlığı (${name}) yok; uygulama ters vekil (Caddy) arkasında çalışmalı.`);
    }
    return null;
  }
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  return (name === "x-forwarded-for" ? parts.at(-1) : parts[0]) ?? null;
}

/** Hız sınırı anahtarları için IP (IPv6 /64 bloğuna indirgenmiş). */
export async function getClientIp(): Promise<string> {
  const ip = await rawClientIp();
  return ip ? normalizeIp(ip) : "bilinmiyor";
}

/** Kayıt için tam IP (sözleşme onayı, açık sipariş sayımı): doğrulanmış, indirgenmemiş. */
export async function getClientIpForRecord(): Promise<string> {
  const ip = (await rawClientIp())?.toLowerCase() ?? "";
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) return ip.slice(7);
  return isIP(ip) ? ip : "bilinmiyor";
}

/**
 * Hız sınırı anahtarı için IP: geçersizse sabit bir kova; IPv6 adresleri /64 önekine indirgenir
 * (tek bir /64 bloğuna sahip saldırgan her istekte farklı adres kullanamasın).
 */
export function normalizeIp(ip: string): string {
  const v = isIP(ip);
  if (v === 4) return ip;
  if (v === 6) {
    if (ip.toLowerCase().startsWith("::ffff:") && isIP(ip.slice(7)) === 4) return ip.slice(7);
    const [head = "", tail = ""] = ip.toLowerCase().split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
    return `${groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":")}::/64`;
  }
  return "gecersiz";
}
