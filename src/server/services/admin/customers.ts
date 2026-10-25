import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";

const { users } = schema;

export const CUSTOMER_PAGE_SIZE = 50;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export type CustomerRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  createdAt: Date;
  orderCount: number;
  totalSpent: number;
};

/**
 * Kayıtlı müşteriler (salt okunur). Sipariş sayısı ödenmiş siparişleri, toplam harcama iptal/iade
 * edilmemiş ödenmiş siparişleri sayar.
 */
export async function listCustomers(input: { q?: string; page?: number } = {}) {
  const where: SQL[] = [eq(users.role, "customer")];
  const q = input.q?.trim().slice(0, 100);
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    where.push(
      or(
        ilike(users.email, pattern),
        ilike(users.firstName, pattern),
        ilike(users.lastName, pattern),
        sql`(${users.firstName} || ' ' || ${users.lastName}) ilike ${pattern}`,
      )!,
    );
  }
  const filter = and(...where);
  const page = Math.max(1, Math.min(Math.trunc(input.page ?? 1) || 1, 10_000));

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        createdAt: users.createdAt,
        orderCount: sql<number>`(select count(*)::int from orders o where o.user_id = "users"."id" and o.paid_at is not null)`,
        totalSpent: sql<number>`(select coalesce(sum(o.total), 0)::int from orders o where o.user_id = "users"."id" and o.status in ('preparing', 'shipped', 'delivered'))`,
      })
      .from(users)
      .where(filter)
      .orderBy(desc(users.createdAt))
      .limit(CUSTOMER_PAGE_SIZE)
      .offset((page - 1) * CUSTOMER_PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(filter),
  ]);
  const total = count?.n ?? 0;
  return {
    items: rows.map((r): CustomerRow => ({ ...r, orderCount: Number(r.orderCount), totalSpent: Number(r.totalSpent) })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE)),
  };
}
