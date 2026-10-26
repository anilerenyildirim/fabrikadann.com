import { logError } from "@/server/log";
import { randomInt } from "node:crypto";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/server/db";
import type { AddressSnapshot } from "@/server/db/schema";
import { randomToken, sha256 } from "@/server/auth/crypto";
import { clearCart, computeShipping, loadCartLines, type CartOwner } from "./cart";
import { getSettings } from "./settings";
import { returnStock, takeStock } from "./stock";
import { audit } from "./audit";

const { orders, orderItems, carts } = schema;

export const PAYMENT_WINDOW_MS = 30 * 60 * 1000;
export const MAX_ITEMS_PER_ORDER = 10;
export const MAX_OPEN_ORDERS = 2;
/** Mobil operatörlerde çok kişi aynı IP'yi paylaşır: IP için daha geniş sınır */
export const MAX_OPEN_ORDERS_PER_IP = 5;
/** Tek IP'den ödenmemiş siparişlerde tutulabilecek toplam çift */
export const MAX_UNPAID_PAIRS_PER_IP = 10;

export type OrderStatus = (typeof schema.orderStatus.enumValues)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: "Ödeme bekleniyor",
  preparing: "Hazırlanıyor",
  shipped: "Kargoda",
  delivered: "Teslim edildi",
  cancelled: "İptal edildi",
  refunded: "İade edildi",
};

/** Panelden yapılabilecek geçişler. "preparing"e yalnızca ödeme onayıyla geçilir. */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  awaiting_payment: ["cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export class OrderError extends Error {
  constructor(
    public code: "empty_cart" | "cart_problems" | "out_of_stock" | "too_many_items" | "too_many_open_orders" | "not_found" | "invalid_transition" | "missing_tracking",
    message: string,
    public details: string[] = [],
  ) {
    super(message);
  }
}

// Karışabilecek harfler (0/O, 1/I) yok
const NUMBER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateOrderNumber(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)];
  return `FD${s}`;
}

export type CreateOrderInput = {
  email: string;
  userId: string | null;
  address: AddressSnapshot;
  ip: string;
};

export type CreatedOrder = { id: string; number: string; total: number; guestAccessToken: string | null };

/**
 * Sepetten sipariş oluşturur. Tek transaction: stok koşullu düşülür, kalemler o anki fiyatla
 * kopyalanır, sepet boşaltılır. Herhangi bir kalem için stok yetmezse hiçbir şey değişmez.
 */
export async function createOrder(owner: CartOwner, input: CreateOrderInput): Promise<CreatedOrder> {
  // Temizlik hatası bu müşterinin siparişini engellemesin
  await releaseExpiredOrders().catch((e) => logError("Süresi dolan siparişler iptal edilemedi", e));
  const settings = await getSettings();

  return db.transaction(async (tx) => {
    const ownerWhere =
      "userId" in owner ? eq(carts.userId, owner.userId) : eq(carts.guestHash, sha256(owner.guestToken));
    // Aynı sepetle eşzamanlı iki sipariş denemesi sıraya girsin
    const [cart] = await tx.select({ id: carts.id }).from(carts).where(ownerWhere).for("update");
    if (!cart) throw new OrderError("empty_cart", "Sepetiniz boş.");
    const lines = await loadCartLines(cart.id, tx);
    if (lines.length === 0) throw new OrderError("empty_cart", "Sepetiniz boş.");
    const problems = lines.filter((l) => l.problem !== null);
    if (problems.length > 0) {
      throw new OrderError(
        "cart_problems",
        "Sepetinizdeki bazı ürünler artık satın alınamıyor.",
        problems.map((p) => `${p.productName} (${p.size})`),
      );
    }

    // Ödenmemiş siparişlerle stok kilitlenmesini sınırla: sipariş başına adet ve kişi başına açık sipariş
    const totalQuantity = lines.reduce((n, l) => n + l.quantity, 0);
    if (totalQuantity > MAX_ITEMS_PER_ORDER) {
      throw new OrderError("too_many_items", `Bir siparişte en fazla ${MAX_ITEMS_PER_ORDER} çift alınabilir.`);
    }
    // Aynı kişiden ya da IP'den eşzamanlı siparişler sıraya girsin ki sayım doğru olsun (kilit sırası sabit)
    const lockKeys = [`siparis:ip:${input.ip}`, `siparis:kisi:${input.userId ?? input.email}`].sort();
    for (const key of lockKeys) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const openWhere = and(eq(orders.status, "awaiting_payment"), gt(orders.paymentExpiresAt, new Date()));
    // Kişi: üyede hesap; misafirde e-posta + IP birlikte (doğrulanmamış e-postayla başkasının siparişi engellenemesin)
    const person = input.userId
      ? eq(orders.userId, input.userId)
      : and(eq(orders.email, input.email), eq(orders.termsAcceptedIp, input.ip));
    const [open] = await tx
      .select({
        byPerson: sql<number>`count(*) filter (where ${person})::int`,
        byIp: sql<number>`count(*) filter (where ${eq(orders.termsAcceptedIp, input.ip)})::int`,
      })
      .from(orders)
      .where(openWhere);
    if ((open?.byPerson ?? 0) >= MAX_OPEN_ORDERS || (open?.byIp ?? 0) >= MAX_OPEN_ORDERS_PER_IP) {
      throw new OrderError(
        "too_many_open_orders",
        "Ödemesi tamamlanmamış siparişleriniz var. Önce onları tamamlayın ya da 30 dakika sonra yeniden deneyin.",
      );
    }

    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const shippingFee = computeShipping(subtotal, settings);
    const guestAccessToken = input.userId ? null : randomToken();

    let order: typeof orders.$inferSelect | undefined;
    for (let attempt = 0; attempt < 5 && !order; attempt++) {
      [order] = await tx
        .insert(orders)
        .values({
          number: generateOrderNumber(),
          userId: input.userId,
          email: input.email,
          guestAccessHash: guestAccessToken ? sha256(guestAccessToken) : null,
          shippingAddress: input.address,
          subtotal,
          shippingFee,
          total: subtotal + shippingFee,
          paymentExpiresAt: new Date(Date.now() + PAYMENT_WINDOW_MS),
          termsAcceptedAt: new Date(),
          termsAcceptedIp: input.ip,
        })
        .onConflictDoNothing({ target: orders.number })
        .returning();
    }
    if (!order) throw new Error("Sipariş numarası üretilemedi");

    // Kilit sırası sabit olsun (eşzamanlı siparişlerde kilitlenme olmasın)
    const sorted = [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
    // Tek bir IP'den gelen ödenmemiş siparişler toplamda en fazla MAX_UNPAID_PAIRS_PER_IP çift tutabilir:
    // sahte siparişlerle stok kilitlemek pahalılaşır, gerçek müşterinin siparişi başkasının ayırması yüzünden reddedilmez
    const [pairs] = await tx
      .select({ n: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(openWhere, eq(orders.termsAcceptedIp, input.ip)));
    if ((pairs?.n ?? 0) + totalQuantity > MAX_UNPAID_PAIRS_PER_IP) {
      throw new OrderError(
        "too_many_open_orders",
        "Ödemesi tamamlanmamış siparişleriniz var. Önce onları tamamlayın ya da 30 dakika sonra yeniden deneyin.",
      );
    }
    const short: string[] = [];
    for (const line of sorted) {
      const ok = await takeStock(tx, line.variantId, line.quantity, { reason: "order", reference: order.number });
      if (!ok) short.push(`${line.productName} (${line.size})`);
    }
    if (short.length > 0) {
      throw new OrderError("out_of_stock", "Üzgünüz, bazı ürünler siz alışveriş yaparken tükendi.", short);
    }

    await tx.insert(orderItems).values(
      lines.map((l) => ({
        orderId: order.id,
        variantId: l.variantId,
        productName: l.productName,
        productSlug: l.productSlug,
        colorName: l.colorName,
        size: l.size,
        sku: l.sku,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        imageKey: l.image?.key ?? null,
      })),
    );
    await clearCart(cart.id, tx);
    return { id: order.id, number: order.number, total: order.total, guestAccessToken };
  });
}

async function restockOrder(tx: Tx, orderId: string, number: string, reason: "cancel" | "order", actorId?: string) {
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  // createOrder ile aynı kilit sırası (kilitlenme olmasın)
  for (const item of [...items].sort((a, b) => (a.variantId ?? "").localeCompare(b.variantId ?? ""))) {
    if (item.variantId) {
      await returnStock(tx, item.variantId, item.quantity, { reason, reference: number, actorId });
    }
  }
}

/** Ödeme süresi dolan siparişleri iptal eder ve stoklarını geri koyar. İptal edilen sayıyı döner. */
export async function releaseExpiredOrders(): Promise<number> {
  const expired = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "awaiting_payment"), lt(orders.paymentExpiresAt, new Date())))
    .limit(100);
  let released = 0;
  for (const { id } of expired) {
    await db.transaction(async (tx) => {
      // Durum koşullu güncellenir: aynı anda ödeme onayı gelirse yalnızca biri kazanır
      const [cancelled] = await tx
        .update(orders)
        .set({ status: "cancelled", cancelReason: "payment_expired" })
        .where(and(eq(orders.id, id), eq(orders.status, "awaiting_payment"), lt(orders.paymentExpiresAt, new Date())))
        .returning({ id: orders.id, number: orders.number });
      if (cancelled) {
        await restockOrder(tx, cancelled.id, cancelled.number, "cancel");
        released++;
      }
    });
  }
  return released;
}

/**
 * Ödemesi süresi dolduğu için iptal edilmiş bir siparişi, ödeme sonradan onaylanırsa yeniden
 * canlandırmayı dener: stok hâlâ varsa düşer ve true döner.
 */
export async function tryReviveCancelledOrder(tx: Tx, orderId: string): Promise<boolean> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  // Yalnızca süre dolması yüzünden iptal edilenler canlanır; yöneticinin iptali kalıcıdır
  if (!order || order.status !== "cancelled" || order.paidAt || order.cancelReason !== "payment_expired") return false;
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  for (const item of [...items].sort((a, b) => (a.variantId ?? "").localeCompare(b.variantId ?? ""))) {
    if (!item.variantId) return false;
    const ok = await takeStock(tx, item.variantId, item.quantity, { reason: "order", reference: order.number });
    if (!ok) throw new OrderError("out_of_stock", "Stok yetersiz");
  }
  return true;
}

export type TransitionOptions = {
  carrier?: string;
  trackingNumber?: string;
  restock?: boolean;
  /** Ekranda görülen durum; bu arada değiştiyse (ör. ödeme geldiyse) işlem reddedilir */
  expectedFrom?: OrderStatus;
};

export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  actorId: string,
  opts: TransitionOptions = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw new OrderError("not_found", "Sipariş bulunamadı.");
    if (opts.expectedFrom && opts.expectedFrom !== order.status) {
      throw new OrderError(
        "invalid_transition",
        `Sipariş bu arada "${ORDER_STATUS_LABELS[order.status]}" durumuna geçti. Sayfayı yenileyip tekrar deneyin.`,
      );
    }
    if (!ALLOWED_TRANSITIONS[order.status].includes(to)) {
      throw new OrderError(
        "invalid_transition",
        `"${ORDER_STATUS_LABELS[order.status]}" durumundan "${ORDER_STATUS_LABELS[to]}" durumuna geçilemez.`,
      );
    }
    const patch: Partial<typeof orders.$inferInsert> = { status: to };
    if (to === "shipped") {
      const carrier = opts.carrier?.trim();
      const trackingNumber = opts.trackingNumber?.trim();
      if (!carrier || !trackingNumber) {
        throw new OrderError("missing_tracking", "Kargoya verirken kargo firması ve takip numarası zorunlu.");
      }
      patch.carrier = carrier;
      patch.trackingNumber = trackingNumber;
    }
    if (to === "cancelled") patch.cancelReason = "admin";
    await tx.update(orders).set(patch).where(eq(orders.id, orderId));
    const restock = to === "cancelled" || (to === "refunded" && opts.restock !== false);
    if (restock) await restockOrder(tx, order.id, order.number, "cancel", actorId);
    // Parası alınmış sipariş iptal/iade edildiyse panoda "iade gerekli" olarak görünsün
    if (order.paidAt && (to === "cancelled" || to === "refunded")) {
      await audit({ action: "payment.needs_refund", actorId, target: order.number, data: { reason: to } }, tx);
    }
  });
}

const orderWith = { items: { orderBy: [asc(orderItems.id)] } };

export async function listOrdersForUser(userId: string) {
  // Süresi dolmuş "ödeme bekleniyor" siparişler bakım betiğini beklemeden iptal görünsün
  await releaseExpiredOrders().catch((e) => logError("Süresi dolan siparişler iptal edilemedi", e));
  return db.query.orders.findMany({
    where: eq(orders.userId, userId),
    orderBy: [desc(orders.createdAt)],
    with: orderWith,
    limit: 100,
  });
}

/** Sipariş yalnızca sahibine döner; başkasınınki için null (IDOR yok). */
export async function getOrderForUser(userId: string, number: string) {
  await releaseExpiredOrders().catch((e) => logError("Süresi dolan siparişler iptal edilemedi", e));
  return (
    (await db.query.orders.findFirst({
      where: and(eq(orders.number, number), eq(orders.userId, userId)),
      with: orderWith,
    })) ?? null
  );
}

export async function getOrderForGuest(number: string, accessToken: string) {
  if (!accessToken || accessToken.length > 100) return null;
  await releaseExpiredOrders().catch((e) => logError("Süresi dolan siparişler iptal edilemedi", e));
  return (
    (await db.query.orders.findFirst({
      where: and(eq(orders.number, number), eq(orders.guestAccessHash, sha256(accessToken))),
      with: orderWith,
    })) ?? null
  );
}

export type OrderWithItems = NonNullable<Awaited<ReturnType<typeof getOrderForUser>>>;
