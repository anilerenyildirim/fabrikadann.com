import "server-only";
import { cookies } from "next/headers";
import { randomToken } from "@/server/auth/crypto";
import { getCurrentUser } from "@/server/auth/current";
import type { CartOwner } from "@/server/services/cart";

const secure = process.env.NODE_ENV === "production";
export const GUEST_CART_COOKIE = secure ? "__Host-fd_sepet" : "fd_sepet";
const GUEST_CART_MAX_AGE = 60 * 60 * 24 * 30;

async function readGuestToken(): Promise<string | null> {
  const value = (await cookies()).get(GUEST_CART_COOKIE)?.value;
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

/** Sepet sahibi: giriş yapılmışsa kullanıcı, değilse misafir çerezi; ikisi de yoksa null. */
export async function getCartOwner(): Promise<CartOwner | null> {
  const user = await getCurrentUser();
  if (user) return { userId: user.id };
  const guestToken = await readGuestToken();
  return guestToken ? { guestToken } : null;
}

/** Yalnızca Server Action ve Route Handler içinde: gerekirse misafir çerezi oluşturur. */
export async function getOrCreateCartOwner(): Promise<CartOwner> {
  const existing = await getCartOwner();
  if (existing) return existing;
  const guestToken = randomToken();
  (await cookies()).set(GUEST_CART_COOKIE, guestToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_CART_MAX_AGE,
  });
  return { guestToken };
}

export async function getGuestCartToken(): Promise<string | null> {
  return readGuestToken();
}

export async function clearGuestCartCookie(): Promise<void> {
  (await cookies()).delete({ name: GUEST_CART_COOKIE, path: "/", secure, httpOnly: true, sameSite: "lax" });
}
