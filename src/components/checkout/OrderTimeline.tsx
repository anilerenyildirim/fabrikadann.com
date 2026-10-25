import type { OrderStatus } from "@/server/services/orders";

const STEPS = ["Sipariş alındı", "Hazırlanıyor", "Kargoda", "Teslim edildi"] as const;

/** Durumun çizelgedeki yeri; çizelgede yer almayan durumlar (ödeme bekleniyor, iptal, iade) için null. */
export function timelineIndex(status: OrderStatus): number | null {
  switch (status) {
    case "preparing":
      return 1;
    case "shipped":
      return 2;
    case "delivered":
      return 3;
    default:
      return null;
  }
}

/** Sipariş alındı → Hazırlanıyor → Kargoda → Teslim edildi. */
export function OrderTimeline({ status }: { status: OrderStatus }) {
  const current = timelineIndex(status);
  if (current === null) return null;
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Sipariş durumu">
      {STEPS.map((label, i) => {
        const reached = i <= current;
        return (
          <li key={label} aria-current={i === current ? "step" : undefined} className="min-w-0">
            <span aria-hidden="true" className={`block h-0.5 ${reached ? "bg-ink" : "bg-rule"}`} />
            <span
              className={`mt-2 block text-[0.6875rem] leading-tight sm:text-[0.75rem] ${
                i === current ? "font-medium text-ink" : reached ? "text-ink" : "text-ash"
              }`}
            >
              {label}
              <span className="sr-only">{i < current ? " (tamamlandı)" : i === current ? " (şu an)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
