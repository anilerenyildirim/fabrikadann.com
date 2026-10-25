import Link from "next/link";
import { ProductImage } from "@/components/ui/ProductImage";
import { formatPrice } from "@/lib/money";
import type { ImageRef } from "@/server/services/catalog";

export type SummaryItem = {
  id: string;
  name: string;
  slug: string;
  colorName: string;
  size: string;
  quantity: number;
  unitPrice: number;
  image: ImageRef | null;
};

/** Sipariş özetindeki küçük görselli kalem listesi (ödeme ve sipariş sayfası). */
export function ItemList({ items, linkProducts = false }: { items: SummaryItem[]; linkProducts?: boolean }) {
  return (
    <ul className="divide-y divide-rule">
      {items.map((item) => (
        <li key={item.id} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-4 py-4 first:pt-0">
          <ProductImage image={item.image} sizes="64px" className="h-auto w-full" />
          <div className="min-w-0 text-[0.8125rem]">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-words uppercase tracking-[0.04em]">
                {linkProducts ? (
                  <Link href={`/urun/${item.slug}`} className="-my-3 block py-3 hover:underline hover:underline-offset-4">
                    {item.name}
                  </Link>
                ) : (
                  item.name
                )}
              </p>
              <p className="tabular shrink-0">{formatPrice(item.unitPrice * item.quantity)}</p>
            </div>
            <p className="mt-1 text-graphite">
              {item.colorName} · {item.size} numara
            </p>
            <p className="tabular text-graphite">
              {item.quantity} adet{item.quantity > 1 ? ` × ${formatPrice(item.unitPrice)}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Totals({
  subtotal,
  shippingFee,
  total,
}: {
  subtotal: number;
  shippingFee: number;
  total: number;
}) {
  return (
    <dl className="space-y-2 text-[0.8125rem]">
      <div className="flex justify-between gap-4">
        <dt>Ara toplam</dt>
        <dd className="tabular">{formatPrice(subtotal)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt>Kargo</dt>
        <dd className="tabular">{shippingFee === 0 ? "Ücretsiz" : formatPrice(shippingFee)}</dd>
      </div>
      <div className="flex justify-between gap-4 border-t border-rule pt-3 text-[0.875rem] font-medium">
        <dt>Toplam</dt>
        <dd className="tabular">{formatPrice(total)}</dd>
      </div>
      <p className="text-[0.75rem] text-graphite">KDV dahil</p>
    </dl>
  );
}
