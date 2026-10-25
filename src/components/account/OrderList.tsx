import Link from "next/link";
import { formatPrice } from "@/lib/money";
import { ORDER_STATUS_LABELS, type OrderWithItems } from "@/server/services/orders";
import { mediaUrl } from "@/server/storage/images";

const dateFormat = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Istanbul",
});

export function formatOrderDate(date: Date): string {
  return dateFormat.format(date);
}

export function OrderList({ orders }: { orders: OrderWithItems[] }) {
  return (
    <ul className="border-t border-rule">
      {orders.map((order) => {
        const first = order.items[0];
        const count = order.items.reduce((n, i) => n + i.quantity, 0);
        return (
          <li key={order.id} className="border-b border-rule">
            <Link href={`/siparis/${order.number}`} className="group flex gap-4 py-5">
              <div className="w-16 shrink-0 sm:w-20">
                {first?.imageKey ? (
                  // eslint-disable-next-line @next/next/no-img-element -- küçük önizleme, boyutlar sabit
                  <img
                    src={mediaUrl(first.imageKey, 400)}
                    alt=""
                    width={80}
                    height={100}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[4/5] w-full bg-fog object-cover"
                  />
                ) : (
                  <div className="aspect-[4/5] w-full bg-fog" aria-hidden="true" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="label tabular">{order.number}</span>
                  <span className="label">{ORDER_STATUS_LABELS[order.status]}</span>
                </div>
                <span className="text-[0.8125rem] text-graphite">
                  {formatOrderDate(order.createdAt)} · {count} ürün
                </span>
                {first && (
                  <span className="truncate text-[0.8125rem] text-graphite">
                    {first.productName}
                    {order.items.length > 1 ? ` ve ${order.items.length - 1} ürün daha` : ""}
                  </span>
                )}
                {order.trackingNumber && (
                  <span className="break-all text-[0.8125rem] text-graphite">
                    Kargo takip: {order.carrier ? `${order.carrier} · ` : ""}
                    <span className="tabular text-ink">{order.trackingNumber}</span>
                  </span>
                )}
                <div className="mt-1 flex items-baseline justify-between gap-4">
                  <span className="tabular text-[0.8125rem]">{formatPrice(order.total)}</span>
                  <span className="label text-graphite underline-offset-4 group-hover:text-ink group-hover:underline">
                    Ayrıntılar
                  </span>
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
