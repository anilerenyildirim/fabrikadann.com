import { formatPrice } from "@/lib/money";

/** Fiyat. Trendyol fiyatı girilmiş ve daha yüksekse iki kanalın fiyatı bilgi olarak yan yana gösterilir. */
export function Price({
  price,
  trendyolPrice,
  size = "sm",
  showComparison = false,
}: {
  price: number;
  trendyolPrice?: number | null;
  size?: "sm" | "lg";
  showComparison?: boolean;
}) {
  const compare = showComparison && trendyolPrice && trendyolPrice > price ? trendyolPrice : null;
  return (
    <div className={`tabular ${size === "lg" ? "text-base" : "text-[0.8125rem]"}`}>
      <span>{formatPrice(price)}</span>
      {compare && (
        <span className="mt-1 block text-[0.75rem] text-graphite">
          Trendyol'da {formatPrice(compare)}
        </span>
      )}
    </div>
  );
}
