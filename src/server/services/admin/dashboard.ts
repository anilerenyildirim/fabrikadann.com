import { and, asc, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { audit } from "../audit";
import { releaseExpiredOrders, type OrderStatus } from "../orders";
import { AdminError, assertAdmin, type AdminContext } from "./context";

const { orders, variants, productColors, products, auditLog } = schema;

export const TIME_ZONE = "Europe/Istanbul";
export const LOW_STOCK = 2;

/** Ciroya sayılan durumlar: ödenmiş ve iptal/iade edilmemiş. */
export const REVENUE_STATUSES: OrderStatus[] = ["preparing", "shipped", "delivered"];

export type DayRevenue = { day: string; total: number; count: number };

/** Son n günün (bugün dahil, İstanbul saatiyle) günlük cirosu; boş günler 0. */
export async function revenueByDay(days = 7): Promise<DayRevenue[]> {
  const result = await db.execute<{ day: string; total: number; count: number }>(sql`
    with d as (
      select to_char(gs, 'YYYY-MM-DD') as day
      from generate_series(
        (now() at time zone ${TIME_ZONE})::date - (${days}::int - 1),
        (now() at time zone ${TIME_ZONE})::date,
        interval '1 day'
      ) as gs
    )
    select d.day,
      coalesce(sum(o.total), 0)::int as total,
      count(o.id)::int as count
    from d
    left join orders o
      on to_char(o.paid_at at time zone ${TIME_ZONE}, 'YYYY-MM-DD') = d.day
      and o.status in ('preparing', 'shipped', 'delivered')
      and o.paid_at >= (((now() at time zone ${TIME_ZONE})::date - (${days}::int - 1))::timestamp at time zone ${TIME_ZONE})
    group by d.day
    order by d.day
  `);
  return result.rows.map((r) => ({ day: r.day, total: Number(r.total), count: Number(r.count) }));
}

export type RefundNeeded = { auditId: string; orderNumber: string | null; orderId: string | null; createdAt: Date };

/** Parası alınmış ama karşılanamayan siparişler (payment.needs_refund) — henüz "iade edildi" işaretlenmemiş olanlar. */
export async function listRefundsNeeded(): Promise<RefundNeeded[]> {
  const rows = await db
    .select({ id: auditLog.id, target: auditLog.target, createdAt: auditLog.createdAt, orderId: orders.id })
    .from(auditLog)
    .leftJoin(orders, eq(orders.number, auditLog.target))
    .where(
      and(
        eq(auditLog.action, "payment.needs_refund"),
        sql`not exists (
          select 1 from audit_log r
          where r.action = 'payment.refund_resolved' and r.target = "audit_log"."id"::text
        )`,
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(50);
  return rows.map((r) => ({ auditId: r.id, orderNumber: r.target, orderId: r.orderId, createdAt: r.createdAt }));
}

/** Ödeme sağlayıcısı panelinden iade yapıldıktan sonra kaydı kapatır. */
export async function resolveRefund(auditId: string, ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  if (!z.uuid().safeParse(auditId).success) throw new AdminError("Kayıt bulunamadı.");
  const [row] = await db
    .select({ id: auditLog.id, target: auditLog.target })
    .from(auditLog)
    .where(and(eq(auditLog.id, auditId), eq(auditLog.action, "payment.needs_refund")));
  if (!row) throw new AdminError("Kayıt bulunamadı.");
  const [already] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.action, "payment.refund_resolved"), eq(auditLog.target, auditId)));
  if (already) return;
  await audit({ action: "payment.refund_resolved", actorId: ctx.actorId, target: auditId, data: { order: row.target }, ip: ctx.ip });
}

export type LowStockRow = {
  variantId: string;
  productId: string;
  productName: string;
  colorName: string;
  size: string;
  sku: string;
  stock: number;
};

export async function listLowStock(limit = 30): Promise<LowStockRow[]> {
  return db
    .select({
      variantId: variants.id,
      productId: products.id,
      productName: products.name,
      colorName: productColors.name,
      size: variants.size,
      sku: variants.sku,
      stock: variants.stock,
    })
    .from(variants)
    .innerJoin(productColors, eq(productColors.id, variants.colorId))
    .innerJoin(products, eq(products.id, productColors.productId))
    .where(and(lte(variants.stock, LOW_STOCK), ne(products.status, "archived")))
    .orderBy(asc(variants.stock), asc(products.name), asc(variants.size))
    .limit(limit);
}

export async function getDashboard() {
  // Panel açılışında süresi dolan ödemelerin stoğu geri gelsin
  await releaseExpiredOrders();

  const [counts, week, refunds, lowStock, recent] = await Promise.all([
    db
      .select({ status: orders.status, n: sql<number>`count(*)::int` })
      .from(orders)
      .where(inArray(orders.status, ["preparing", "awaiting_payment"]))
      .groupBy(orders.status),
    revenueByDay(7),
    listRefundsNeeded(),
    listLowStock(),
    db
      .select({
        id: orders.id,
        number: orders.number,
        email: orders.email,
        shippingAddress: orders.shippingAddress,
        total: orders.total,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .orderBy(desc(orders.createdAt))
      .limit(10),
  ]);

  const countOf = (s: OrderStatus) => counts.find((c) => c.status === s)?.n ?? 0;
  const today = week.at(-1) ?? { day: "", total: 0, count: 0 };
  return {
    toShip: countOf("preparing"),
    awaitingPayment: countOf("awaiting_payment"),
    today,
    week,
    weekTotal: week.reduce((s, d) => s + d.total, 0),
    weekCount: week.reduce((s, d) => s + d.count, 0),
    refunds,
    lowStock,
    recent: recent.map((r) => ({ ...r, fullName: r.shippingAddress.fullName })),
  };
}
