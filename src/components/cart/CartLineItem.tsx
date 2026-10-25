import Link from "next/link";
import { ErrorMark } from "@/components/ui/form";
import { ProductImage } from "@/components/ui/ProductImage";
import { formatPrice } from "@/lib/money";
import { MAX_QTY_PER_LINE, type CartLine } from "@/server/services/cart";
import { CartLineControls } from "./CartLineControls";

function problemText(line: CartLine): string | null {
  switch (line.problem) {
    case "unavailable":
      return "Bu ürün artık satışta değil. Siparişe devam etmek için sepetten çıkarın.";
    case "out_of_stock":
      return "Bu numara tükendi. Siparişe devam etmek için sepetten çıkarın.";
    case "insufficient_stock":
      return `Stokta yalnızca ${line.maxQuantity} adet var. Adedi ${line.maxQuantity} yapın ya da ürünü çıkarın.`;
    default:
      return null;
  }
}

/** href: ürün sayfası (sepetteki renk seçili); satıştan kalkmış üründe null (sayfası açılmaz). */
export function CartLineItem({ line, href }: { line: CartLine; href: string | null }) {
  const problem = problemText(line);
  const muted = line.problem === "unavailable" || line.problem === "out_of_stock";
  const image = <ProductImage image={line.image} sizes="(min-width: 640px) 128px, 96px" className="h-auto w-full" />;

  return (
    <li className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4 py-5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6">
      {href ? (
        <Link href={href} tabIndex={-1} aria-hidden="true" className={muted ? "opacity-50" : undefined}>
          {image}
        </Link>
      ) : (
        <div className={muted ? "opacity-50" : undefined}>{image}</div>
      )}

      <div className="flex min-w-0 flex-col">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-[0.8125rem] uppercase tracking-[0.04em]">
            {href ? (
              // Dolgu + eksi kenar boşluğu: dokunma alanı 44px, yerleşim değişmez
              <Link href={href} className="-my-3 block break-words py-3 hover:underline hover:underline-offset-4">
                {line.productName}
              </Link>
            ) : (
              <span className="block break-words">{line.productName}</span>
            )}
          </h3>
          {!line.problem && <p className="tabular shrink-0 text-[0.8125rem]">{formatPrice(line.lineTotal)}</p>}
        </div>
        <p className="mt-1 text-[0.8125rem] text-graphite">
          {line.colorName} · {line.size} numara
        </p>
        {(line.quantity > 1 || line.problem) && (
          <p className="tabular text-[0.8125rem] text-graphite">Birim fiyat {formatPrice(line.unitPrice)}</p>
        )}

        {problem && (
          <p className="mt-3 flex items-start gap-1.5 text-[0.8125rem] font-medium">
            <ErrorMark />
            <span>{problem}</span>
          </p>
        )}

        <CartLineControls
          lineId={line.id}
          productName={line.productName}
          quantity={line.quantity}
          maxQuantity={line.maxQuantity}
          maxPerLine={MAX_QTY_PER_LINE}
          problem={line.problem}
        />
      </div>
    </li>
  );
}
