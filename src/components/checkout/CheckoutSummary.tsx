import Link from "next/link";
import { formatPrice } from "@/lib/money";
import type { Cart } from "@/server/services/cart";
import { ItemList, Totals, type SummaryItem } from "./ItemList";

const itemsOf = (cart: Cart): SummaryItem[] =>
  cart.lines.map((l) => ({
    id: l.id,
    name: l.productName,
    slug: l.productSlug,
    colorName: l.colorName,
    size: l.size,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    image: l.image,
  }));

function SummaryBody({ cart }: { cart: Cart }) {
  return (
    <>
      <ItemList items={itemsOf(cart)} />
      <div className="mt-4 border-t border-rule pt-4">
        <Totals subtotal={cart.subtotal} shippingFee={cart.shippingFee} total={cart.total} />
      </div>
    </>
  );
}

/** Masaüstünde sağda yapışkan özet. */
export function CheckoutSummaryAside({ cart }: { cart: Cart }) {
  return (
    <aside aria-labelledby="odeme-ozet" className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="odeme-ozet" className="label">
          Sipariş özeti
        </h2>
        <Link href="/sepet" className="label inline-flex min-h-11 items-center text-graphite hover:text-ink hover:underline">
          Düzenle
        </Link>
      </div>
      <div className="mt-2">
        <SummaryBody cart={cart} />
      </div>
    </aside>
  );
}

/** Mobilde formun üstünde, dokununca açılan özet. */
export function CheckoutSummaryDisclosure({ cart }: { cart: Cart }) {
  return (
    <details className="group border-y border-rule lg:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <span className="label flex items-center gap-2">
          <span className="group-open:hidden">Sipariş özetini göster</span>
          <span className="hidden group-open:inline">Sipariş özetini gizle</span>
          <span className="tabular text-graphite">({cart.itemCount})</span>
          <svg
            viewBox="0 0 10 6"
            className="size-2.5 transition-transform group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path d="M0 0l5 6 5-6" />
          </svg>
        </span>
        <span className="tabular font-medium">{formatPrice(cart.total)}</span>
      </summary>
      <div className="pb-5 pt-2">
        <SummaryBody cart={cart} />
        <Link href="/sepet" className="label mt-2 inline-flex min-h-11 items-center underline-offset-4 hover:underline">
          Sepeti düzenle
        </Link>
      </div>
    </details>
  );
}
