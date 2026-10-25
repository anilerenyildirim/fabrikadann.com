import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { checkoutBlocker } from "@/components/cart/CartSummary";
import { CheckoutForm, type CheckoutAddress } from "@/components/checkout/CheckoutForm";
import { CheckoutSummaryAside, CheckoutSummaryDisclosure } from "@/components/checkout/CheckoutSummary";
import { formatPrice } from "@/lib/money";
import { getCurrentUser } from "@/server/auth/current";
import { getCartOwner } from "@/server/cart-owner";
import { listAddresses, MAX_ADDRESSES } from "@/server/services/addresses";
import { getCart } from "@/server/services/cart";
import { cartSignature } from "./_lib/payment";

export const metadata: Metadata = {
  title: "Ödeme",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const [owner, user] = await Promise.all([getCartOwner(), getCurrentUser()]);
  const cart = await getCart(owner);
  // Boş, sorunlu ya da sınırı aşan sepetle ödeme yapılamaz; nedeni sepet sayfasında anlatılıyor
  if (checkoutBlocker(cart)) redirect("/sepet");

  const saved = user ? await listAddresses(user.id) : [];
  const addresses: CheckoutAddress[] = saved.map((a) => ({
    id: a.id,
    title: a.title,
    fullName: a.fullName,
    phone: a.phone,
    city: a.city,
    district: a.district,
    line: a.line,
  }));
  const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : "";

  return (
    <div className="px-4 pb-16 pt-6 md:px-6 md:pt-10">
      <h1 className="wide text-[0.9375rem]">Ödeme</h1>

      <div className="mt-6 lg:mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-20 xl:grid-cols-[minmax(0,40rem)_24rem] xl:justify-between">
        <div className="min-w-0">
          <div className="mb-10 lg:hidden">
            <CheckoutSummaryDisclosure cart={cart} />
          </div>
          <CheckoutForm
            signedInEmail={user?.email ?? null}
            addresses={addresses}
            canSaveAddress={saved.length < MAX_ADDRESSES}
            prefill={{ fullName: fullName || undefined, phone: user?.phone ?? undefined }}
            totalText={formatPrice(cart.total)}
            cartSig={cartSignature(cart)}
          />
        </div>
        <CheckoutSummaryAside cart={cart} />
      </div>
    </div>
  );
}
