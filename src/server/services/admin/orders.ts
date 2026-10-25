import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { sendMail } from "@/server/mail";
import { audit } from "../audit";
import { ALLOWED_TRANSITIONS, ORDER_STATUS_LABELS, OrderError, transitionOrder, type OrderStatus } from "../orders";
import { AdminError, assertAdmin, type AdminContext } from "./context";

const { orders, orderItems, payments } = schema;

export const ORDER_PAGE_SIZE = 30;

export const CARRIERS = [
  "Yurtiçi Kargo",
  "Aras Kargo",
  "MNG Kargo",
  "PTT Kargo",
  "Sürat Kargo",
  "UPS",
  "HepsiJet",
  "Trendyol Express",
  "Diğer",
] as const;

export type Carrier = (typeof CARRIERS)[number];

const ORDER_STATUSES = schema.orderStatus.enumValues;

export const orderStatusSchema = z.enum(ORDER_STATUSES);

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export type AdminOrderRow = {
  id: string;
  number: string;
  email: string;
  fullName: string;
  total: number;
  status: OrderStatus;
  createdAt: Date;
  paidAt: Date | null;
  itemCount: number;
  isGuest: boolean;
};

export async function listAdminOrders(input: { status?: OrderStatus | "all"; q?: string; page?: number } = {}) {
  const where: SQL[] = [];
  if (input.status && input.status !== "all") where.push(eq(orders.status, input.status));
  const q = input.q?.trim().slice(0, 100);
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    where.push(or(ilike(orders.number, pattern), ilike(orders.email, pattern))!);
  }
  const filter = where.length ? and(...where) : undefined;
  const page = Math.max(1, Math.min(Math.trunc(input.page ?? 1) || 1, 10_000));

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: orders.id,
        number: orders.number,
        email: orders.email,
        shippingAddress: orders.shippingAddress,
        total: orders.total,
        status: orders.status,
        createdAt: orders.createdAt,
        paidAt: orders.paidAt,
        userId: orders.userId,
        itemCount: sql<number>`(select coalesce(sum(oi.quantity), 0)::int from order_items oi where oi.order_id = "orders"."id")`,
      })
      .from(orders)
      .where(filter)
      .orderBy(desc(orders.createdAt), asc(orders.id))
      .limit(ORDER_PAGE_SIZE)
      .offset((page - 1) * ORDER_PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(filter),
  ]);

  const total = count?.n ?? 0;
  return {
    items: rows.map(
      (r): AdminOrderRow => ({
        id: r.id,
        number: r.number,
        email: r.email,
        fullName: r.shippingAddress.fullName,
        total: r.total,
        status: r.status,
        createdAt: r.createdAt,
        paidAt: r.paidAt,
        itemCount: r.itemCount,
        isGuest: r.userId === null,
      }),
    ),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE)),
  };
}

export async function getAdminOrder(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: {
      items: { orderBy: [asc(orderItems.productName), asc(orderItems.id)] },
      payments: {
        orderBy: [desc(payments.createdAt)],
        // Ham sağlayıcı yanıtı ve tek kullanımlık token panele gönderilmez
        columns: { id: true, provider: true, providerRef: true, amount: true, status: true, createdAt: true, updatedAt: true },
      },
      user: { columns: { id: true, email: true, firstName: true, lastName: true, phone: true, createdAt: true } },
    },
  });
  if (!order) return null;
  const { guestAccessHash: _hash, ...rest } = order;
  return { ...rest, isGuest: order.userId === null, allowed: ALLOWED_TRANSITIONS[order.status] };
}

export type AdminOrder = NonNullable<Awaited<ReturnType<typeof getAdminOrder>>>;

export const transitionInputSchema = z
  .object({
    to: orderStatusSchema,
    carrier: z.enum(CARRIERS, { error: "Kargo firmasını seçin." }).optional(),
    carrierOther: z.string().trim().max(40, "Kargo firması adı en fazla 40 karakter olabilir.").optional(),
    trackingNumber: z
      .string()
      .trim()
      .max(40, "Takip numarası en fazla 40 karakter olabilir.")
      .regex(/^[A-Za-z0-9-]*$/, "Takip numarası yalnızca harf, rakam ve tire içerebilir.")
      .optional(),
    restock: z.boolean().optional(),
    /** Ekranda görülen durum; sipariş bu arada değiştiyse geçiş reddedilir */
    expectedFrom: orderStatusSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.to !== "shipped") return;
    if (!v.carrier) ctx.addIssue({ code: "custom", path: ["carrier"], message: "Kargo firmasını seçin." });
    if (v.carrier === "Diğer" && !v.carrierOther) {
      ctx.addIssue({ code: "custom", path: ["carrierOther"], message: "Kargo firmasının adını yazın." });
    }
    if (!v.trackingNumber || v.trackingNumber.length < 4) {
      ctx.addIssue({ code: "custom", path: ["trackingNumber"], message: "Kargo takip numarasını yazın (en az 4 karakter)." });
    }
  });

export type TransitionInput = z.input<typeof transitionInputSchema>;

export type TransitionResult = { mailSent: boolean | null };

/**
 * Panelden durum değişikliği. İzinli geçişler ve stok iadesi orders.transitionOrder'da;
 * burada yetki, girdi doğrulaması, günlük kaydı ve kargo e-postası.
 */
export async function changeOrderStatus(orderId: string, raw: TransitionInput, ctx: AdminContext): Promise<TransitionResult> {
  await assertAdmin(ctx);
  if (!z.uuid().safeParse(orderId).success) throw new AdminError("Sipariş bulunamadı.");
  const parsed = transitionInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AdminError(issue?.message ?? "Geçersiz istek.", issue?.path.join(".") || undefined);
  }
  const input = parsed.data;
  const [before] = await db
    .select({ status: orders.status, number: orders.number })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!before) throw new AdminError("Sipariş bulunamadı.");

  const carrier = input.to === "shipped" ? (input.carrier === "Diğer" ? input.carrierOther! : input.carrier!) : undefined;
  const restock = input.to === "refunded" ? input.restock === true : undefined;

  try {
    await transitionOrder(orderId, input.to, ctx.actorId, {
      carrier,
      trackingNumber: input.to === "shipped" ? input.trackingNumber : undefined,
      restock,
      expectedFrom: input.expectedFrom,
    });
  } catch (e) {
    if (e instanceof OrderError) throw new AdminError(e.message);
    throw e;
  }

  await audit({
    action: "order.status",
    actorId: ctx.actorId,
    target: before.number,
    data: {
      orderId,
      from: before.status,
      to: input.to,
      ...(carrier ? { carrier, trackingNumber: input.trackingNumber } : {}),
      ...(restock !== undefined ? { restock } : {}),
    },
    ip: ctx.ip,
  });

  if (input.to !== "shipped") return { mailSent: null };
  try {
    await sendShippedMail(orderId);
    return { mailSent: true };
  } catch (e) {
    console.error("Kargo e-postası gönderilemedi", e);
    await audit({ action: "order.ship_mail_failed", actorId: ctx.actorId, target: before.number, ip: ctx.ip });
    return { mailSent: false };
  }
}

async function sendShippedMail(orderId: string) {
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId), with: { items: true } });
  if (!order || !order.carrier || !order.trackingNumber) return;
  const lines = order.items.map((i) => `- ${i.productName} / ${i.colorName} / ${i.size} × ${i.quantity}`);
  await sendMail({
    to: order.email,
    subject: `fabrikadann — siparişiniz kargoda (${order.number})`,
    text: [
      `Merhaba ${order.shippingAddress.fullName},`,
      "",
      `${order.number} numaralı siparişiniz kargoya verildi.`,
      "",
      `Kargo firması: ${order.carrier}`,
      `Takip numarası: ${order.trackingNumber}`,
      "",
      ...lines,
      "",
      "Kargonuzu kargo firmasının sitesinden takip numarasıyla izleyebilirsiniz.",
      "fabrikadann",
    ].join("\n"),
  });
}

export { ALLOWED_TRANSITIONS, ORDER_STATUS_LABELS, ORDER_STATUSES };

/** Sipariş sayfasındaki müşteri kartı için: kayıtlı kullanıcının diğer siparişlerinin sayısı. */
export async function countOrdersOfUser(userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.userId, userId));
  return row?.n ?? 0;
}
