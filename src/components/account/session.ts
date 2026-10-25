import "server-only";
import { readSessionToken, setSessionCookie } from "@/server/auth/current";
import { createSession, deleteSession, markSecondFactor } from "@/server/auth/session";
import { clearGuestCartCookie, getGuestCartToken } from "@/server/cart-owner";
import { mergeGuestCart } from "@/server/services/cart";

/**
 * Yalnızca Server Action içinde: yeni oturum açar (eski oturum varsa silinir, session fixation yok)
 * ve misafir sepetini kullanıcının sepetine taşır.
 *
 * keepSecondFactor: yalnızca aynı kişinin zaten iki adımı geçmiş oturumunu yenilerken (parola
 * değiştirme) kullanılır; yönetici yeniden TOTP girmek zorunda kalmasın.
 */
export async function startSession(
  user: { id: string; role: "customer" | "admin" },
  { keepSecondFactor = false }: { keepSecondFactor?: boolean } = {},
): Promise<void> {
  const previous = await readSessionToken();
  if (previous) await deleteSession(previous);

  const { token, expiresAt } = await createSession(user.id, user.role);
  if (keepSecondFactor) await markSecondFactor(token);
  await setSessionCookie(token, expiresAt);

  const guestToken = await getGuestCartToken();
  if (guestToken) {
    try {
      await mergeGuestCart(guestToken, user.id);
      await clearGuestCartCookie();
    } catch (e) {
      // Sepet birleşmese de giriş tamamlansın; misafir sepeti çerezde kalır, sonraki girişte yeniden denenir
      console.error("[giris] misafir sepeti birleştirilemedi", e);
    }
  }
}
