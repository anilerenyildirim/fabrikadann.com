import { Button, ButtonLink } from "@/components/ui/form";
import { formatPrice } from "@/lib/money";
import type { Cart } from "@/server/services/cart";
import { MAX_ITEMS_PER_ORDER, PAYMENT_WINDOW_MS } from "@/server/services/orders";

/** Sepette siparişin üst sınırını aşan çift sayısı; aşmıyorsa 0. */
export const itemsOverLimit = (cart: Pick<Cart, "itemCount">) => Math.max(0, cart.itemCount - MAX_ITEMS_PER_ORDER);

/** Ödemeye geçilemiyorsa nedeni; geçilebiliyorsa null. */
export function checkoutBlocker(cart: Cart): string | null {
  if (cart.lines.length === 0) return "Sepetiniz boş.";
  if (cart.hasProblems) return "Ödemeye geçmek için işaretli ürünleri düzenleyin ya da sepetten çıkarın.";
  const over = itemsOverLimit(cart);
  if (over > 0) {
    return `Bir siparişte en fazla ${MAX_ITEMS_PER_ORDER} çift alınabilir. Ödemeye geçmek için ${over} çift çıkarın.`;
  }
  return null;
}

export function CheckoutButton({ cart, id }: { cart: Cart; id: string }) {
  const blocker = checkoutBlocker(cart);
  if (!blocker) {
    return (
      <ButtonLink href="/odeme" full>
        Ödemeye geç
      </ButtonLink>
    );
  }
  return (
    <>
      <Button type="button" disabled full aria-describedby={`${id}-neden`}>
        Ödemeye geç
      </Button>
      <p id={`${id}-neden`} className="mt-2 text-[0.75rem] text-graphite">
        {blocker}
      </p>
    </>
  );
}

const shippingText = (cart: Cart) =>
  cart.subtotal === 0 ? "—" : cart.shippingFee === 0 ? "Ücretsiz" : formatPrice(cart.shippingFee);

/** Ara toplam, kargo, ücretsiz kargoya kalan tutar ve toplam. Masaüstünde ödeme butonunu da taşır. */
export function CartSummary({ cart }: { cart: Cart }) {
  const remaining = cart.freeShippingThreshold - cart.subtotal;
  const showFreeShippingHint = cart.subtotal > 0 && cart.shippingFee > 0 && remaining > 0;
  const progress = Math.min(100, Math.round((cart.subtotal / Math.max(1, cart.freeShippingThreshold)) * 100));

  return (
    <aside aria-labelledby="sepet-ozet" className="mt-10 md:sticky md:top-24 md:mt-0 md:self-start">
      <h2 id="sepet-ozet" className="label">
        Sipariş özeti
      </h2>
      <dl className="mt-4 space-y-2 text-[0.8125rem]">
        <div className="flex justify-between gap-4">
          <dt>Ara toplam</dt>
          <dd className="tabular">{formatPrice(cart.subtotal)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Kargo</dt>
          <dd className="tabular">{shippingText(cart)}</dd>
        </div>
        <div className="hidden justify-between gap-4 border-t border-rule pt-3 text-[0.875rem] font-medium md:flex">
          <dt>Toplam</dt>
          <dd className="tabular">{formatPrice(cart.total)}</dd>
        </div>
      </dl>

      {showFreeShippingHint && (
        <div className="mt-5">
          <p className="text-[0.8125rem]">
            <span className="tabular">{formatPrice(remaining)}</span> daha ekleyin, kargo ücretsiz.
          </p>
          <div className="mt-2 h-0.5 bg-rule" aria-hidden="true">
            <div className="h-0.5 bg-ink" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {cart.subtotal > 0 && cart.shippingFee === 0 && (
        <p className="mt-5 text-[0.8125rem] text-graphite">Siparişinizde kargo ücretsiz.</p>
      )}

      <div className="mt-6 hidden md:block">
        <CheckoutButton cart={cart} id="odeme-masaustu" />
      </div>
      <p className="mt-4 text-[0.75rem] text-graphite">
        Fiyatlara KDV dahildir. Ürünler siparişi onayladığınızda sizin için ayrılır; ödemeyi{" "}
        {PAYMENT_WINDOW_MS / 60_000} dakika içinde tamamlayın.
      </p>
    </aside>
  );
}

/** Mobilde ekranın altında duran toplam + ödeme butonu. */
export function MobileCheckoutBar({ cart }: { cart: Cart }) {
  return (
    <div className="sticky bottom-0 z-30 -mx-4 mt-10 border-t border-rule bg-paper px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:hidden">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <span className="label">Toplam</span>
        <span className="tabular font-medium">{formatPrice(cart.total)}</span>
      </div>
      <CheckoutButton cart={cart} id="odeme-mobil" />
    </div>
  );
}
