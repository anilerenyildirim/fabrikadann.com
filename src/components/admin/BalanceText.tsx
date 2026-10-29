import { formatPrice } from "@/lib/money";

/** Pozitif: biz borçluyuz. */
export function BalanceText({ amount }: { amount: number }) {
  if (amount === 0) return <span className="text-graphite">0,00 TL</span>;
  return (
    <span className="whitespace-nowrap">
      {formatPrice(Math.abs(amount))}
      <span className="ml-1 text-[0.75rem] text-graphite">{amount > 0 ? "borç" : "alacak"}</span>
    </span>
  );
}
