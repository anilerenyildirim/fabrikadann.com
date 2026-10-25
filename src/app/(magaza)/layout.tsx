import { CookieNotice } from "@/components/CookieNotice";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { getCurrentUser } from "@/server/auth/current";
import { getCartOwner } from "@/server/cart-owner";
import { getCart } from "@/server/services/cart";
import { listCategories } from "@/server/services/catalog";
import { getSettings } from "@/server/services/settings";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [categories, settings, user, owner] = await Promise.all([
    listCategories(),
    getSettings(),
    getCurrentUser(),
    getCartOwner(),
  ]);
  const cart = await getCart(owner);
  return (
    <>
      <a
        href="#icerik"
        className="label sr-only z-[60] bg-ink px-4 py-3 text-paper focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        İçeriğe geç
      </a>
      <SiteHeader
        categories={categories.map((c) => ({ name: c.name, slug: c.slug }))}
        cartCount={cart.itemCount}
        signedIn={user !== null}
        announcement={settings.announcement || undefined}
      />
      <main id="icerik">{children}</main>
      <SiteFooter settings={settings} />
      <CookieNotice />
    </>
  );
}
