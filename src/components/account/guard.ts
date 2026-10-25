import "server-only";
import { redirect } from "next/navigation";
import { getSession, requireUser } from "@/server/auth/current";

/**
 * Hesap sayfaları ve action'ları için requireUser. Ek olarak, yalnızca parolayla açılmış
 * (iki adımlı doğrulaması tamamlanmamış) yönetici oturumu hesap verilerine erişemez,
 * parolayı ya da profili değiştiremez; önce ikinci adıma gönderilir.
 */
export async function requireAccountUser(returnTo: string) {
  const user = await requireUser(returnTo);
  if (user.role === "admin") {
    const session = await getSession();
    if (!session?.secondFactor) redirect("/yonetim/iki-adim");
  }
  return user;
}
