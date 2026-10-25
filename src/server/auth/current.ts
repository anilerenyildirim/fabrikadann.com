import "server-only";
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

export async function getCurrentUser() {
  return (await getSession())?.user ?? null;
}

export async function signOut() {
  const token = await readSessionToken();
  if (token) await deleteSession(token);
  (await cookies()).delete(SESSION_COOKIE);
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
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const name = process.env.CLIENT_IP_HEADER?.toLowerCase() || "x-forwarded-for";
  const raw = h.get(name);
  if (!raw) return "0.0.0.0";
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  return (name === "x-forwarded-for" ? parts.at(-1) : parts[0]) ?? "0.0.0.0";
}
