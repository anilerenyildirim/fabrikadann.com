import type { Metadata } from "next";
import { CartLineItem } from "@/components/cart/CartLineItem";
import { CartSummary, itemsOverLimit, MobileCheckoutBar } from "@/components/cart/CartSummary";
import { ButtonLink, FormNotice } from "@/components/ui/form";
import { getCartOwner } from "@/server/cart-owner";
import { getCart, type CartLine } from "@/server/services/cart";
import { getProductBySlug } from "@/server/services/catalog";
import { MAX_ITEMS_PER_ORDER } from "@/server/services/orders";

export const metadata: Metadata = {
  title: "Sepet",
  robots: { index: false, follow: false },
};

/**
 * Satırdan ürün sayfasına bağlantı: sepetteki rengin sayfası (?renk=<renk kimliği>), ürünün ilk
 * rengiyse yalın ürün adresi. Satıştan kalkmış ürünün sayfası açılmadığı için bağlantı verilmez.
 */
async function productLinks(lines: CartLine[]): Promise<Map<string, string | null>> {
  const slugs = [...new Set(lines.filter((l) => l.problem !== "unavailable").map((l) => l.productSlug))];
  const products = await Promise.all(slugs.map((slug) => getProductBySlug(slug)));
  const colorOfVariant = new Map<string, { slug: string; colorId: string; isDefault: boolean }>();
  for (const product of products) {
    product?.colors.forEach((color, i) => {
      for (const v of color.variants) {
        colorOfVariant.set(v.id, { slug: product.slug, colorId: color.id, isDefault: i === 0 });
      }
    });
  }
  return new Map(
    lines.map((l) => {
      if (l.problem === "unavailable") return [l.id, null];
      const c = colorOfVariant.get(l.variantId);
      const href = c && !c.isDefault ? `/urun/${c.slug}?renk=${c.colorId}` : `/urun/${l.productSlug}`;
      return [l.id, href];
    }),
  );
}

export default async function CartPage() {
  const cart = await getCart(await getCartOwner());

  if (cart.lines.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 pb-16 pt-20 text-center md:pt-28">
        <h1 className="wide text-[0.9375rem]">Sepetiniz boş</h1>
        <p className="mt-4 max-w-sm text-[0.8125rem] text-graphite">
          Beğendiğiniz modeli numaranızı seçerek sepete ekleyin. Ödemeye buradan geçersiniz.
        </p>
        <ButtonLink href="/urunler" className="mt-10">
          Ürünlere göz at
        </ButtonLink>
      </div>
    );
  }

  const links = await productLinks(cart.lines);
  const over = itemsOverLimit(cart);

  return (
    <div className="px-4 pt-6 md:px-6 md:pb-16 md:pt-10">
      <h1 className="wide text-[0.9375rem]">
        Sepet <span className="tabular text-graphite">({cart.itemCount})</span>
      </h1>

      {(cart.hasProblems || over > 0) && (
        <div className="mt-6 max-w-2xl space-y-3">
          {cart.hasProblems && (
            <FormNotice>
              Sepetinizdeki bazı ürünler şu an satın alınamıyor. İşaretli ürünleri düzenleyin ya da çıkarın, sonra
              ödemeye geçin.
            </FormNotice>
          )}
          {over > 0 && (
            <FormNotice>
              Bir siparişte en fazla {MAX_ITEMS_PER_ORDER} çift alınabilir; sepetinizde {cart.itemCount} çift var.
              Ödemeye geçmek için {over} çift çıkarın.
            </FormNotice>
          )}
        </div>
      )}

      <div className="mt-6 md:grid md:grid-cols-[minmax(0,1fr)_18rem] md:gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-20">
        <section aria-labelledby="sepet-urunler">
          <h2 id="sepet-urunler" className="sr-only">
            Sepetinizdeki ürünler
          </h2>
          <ul className="divide-y divide-rule border-y border-rule">
            {cart.lines.map((line) => (
              <CartLineItem key={line.id} line={line} href={links.get(line.id) ?? null} />
            ))}
          </ul>
        </section>
        <CartSummary cart={cart} />
      </div>

      <MobileCheckoutBar cart={cart} />
    </div>
  );
}
