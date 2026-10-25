import { logError } from "@/server/log";
import { and, eq, gt, isNotNull, lt } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { randomToken } from "@/server/auth/crypto";
import { getPaymentProvider } from "@/server/payments";
import { sendMail } from "@/server/mail";
import { formatPrice } from "@/lib/money";
import { audit } from "./audit";
import { OrderError, tryReviveCancelledOrder } from "./orders";

const { orders, payments } = schema;

export class PaymentError extends Error {}

/** Bekleyen bir sipariş için yeni ödeme denemesi açar ve sağlayıcının yönlendirme adresini döner. */
export async function startPayment(orderId: string, ctx: { appUrl: string; ip: string }) {
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId), with: { items: true } });
  if (!order || order.status !== "awaiting_payment" || order.paymentExpiresAt < new Date()) {
    throw new PaymentError("Bu sipariş için ödeme yapılamaz. Süresi dolmuş olabilir.");
  }
  const provider = getPaymentProvider();
  const token = randomToken();
  const [payment] = await db
    .insert(payments)
    .values({ orderId, provider: provider.name, token, amount: order.total })
    .returning({ id: payments.id });
  const started = await provider.start({
    token,
    callbackUrl: `${ctx.appUrl}/api/odeme/${provider.name}`,
    order: {
      id: order.id,
      number: order.number,
      total: order.total,
      email: order.email,
      ip: ctx.ip,
      address: order.shippingAddress,
      items: order.items.map((i) => ({ name: i.productName, sku: i.sku, unitPrice: i.unitPrice, quantity: i.quantity })),
    },
  });
  // Tarayıcı dönüşü hiç gelmezse mutabakat bu kimlikle sağlayıcıya sorar
  if (started.providerSessionId) {
    await db.update(payments).set({ providerSession: started.providerSessionId }).where(eq(payments.id, payment!.id));
  }
  return { redirectUrl: started.redirectUrl };
}

export type PaymentOutcome = {
  token: string;
  success: boolean;
  /** Sağlayıcının bildirdiği (doğrulanmış) tahsil edilen tutar, kuruş */
  amount: number;
  providerRef?: string | null;
  raw?: unknown;
};

export type CompletionStatus = "paid" | "failed" | "already_processed" | "amount_mismatch" | "needs_refund" | "not_found";

/**
 * Sağlayıcıdan gelen sonucu işler. İdempotenttir: aynı ödeme ikinci kez işlenmez.
 * Tutar beklenenle eşleşmezse sipariş onaylanmaz.
 */
export async function completePayment(outcome: PaymentOutcome): Promise<{ status: CompletionStatus; orderNumber?: string; orderId?: string }> {
  const result = await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.token, outcome.token)).for("update");
    if (!payment) return { status: "not_found" as const };
    const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).for("update");
    if (!order) return { status: "not_found" as const };
    const base = { orderNumber: order.number, orderId: order.id };

    if (payment.status !== "pending") return { status: "already_processed" as const, ...base };

    const finish = (status: "succeeded" | "failed") =>
      tx
        .update(payments)
        .set({ status, providerRef: outcome.providerRef ?? null, raw: outcome.raw ?? null })
        .where(eq(payments.id, payment.id));

    if (!outcome.success) {
      await finish("failed");
      return { status: "failed" as const, ...base };
    }

    if (outcome.amount !== payment.amount || payment.amount !== order.total) {
      await finish("failed");
      await audit(
        { action: "payment.amount_mismatch", target: order.number, data: { expected: order.total, got: outcome.amount } },
        tx,
      );
      // Sağlayıcı başarılı dediyse para çekilmiş olabilir: iade listesinde görünsün
      await audit({ action: "payment.needs_refund", target: order.number, data: { paymentId: payment.id, reason: "amount_mismatch" } }, tx);
      return { status: "amount_mismatch" as const, ...base };
    }

    await finish("succeeded");

    if (order.status === "awaiting_payment") {
      await tx.update(orders).set({ status: "preparing", paidAt: new Date() }).where(eq(orders.id, order.id));
      return { status: "paid" as const, ...base };
    }

    if (order.status === "cancelled" && !order.paidAt) {
      // Ödeme süresi dolduktan hemen sonra gelen onay: stok hâlâ varsa siparişi geri al
      try {
        const revived = await tx.transaction((sp) => tryReviveCancelledOrder(sp, order.id));
        if (revived) {
          await tx.update(orders).set({ status: "preparing", paidAt: new Date() }).where(eq(orders.id, order.id));
          return { status: "paid" as const, ...base };
        }
      } catch (e) {
        if (!(e instanceof OrderError)) throw e;
      }
    }

    // Para alındı ama sipariş karşılanamıyor (stok yok ya da çift ödeme): iade gerekli
    await audit({ action: "payment.needs_refund", target: order.number, data: { paymentId: payment.id } }, tx);
    return { status: "needs_refund" as const, ...base };
  });

  if (result.status === "paid" && result.orderId) {
    await sendOrderConfirmation(result.orderId).catch((e) => logError("Sipariş e-postası gönderilemedi", e));
  }
  return result;
}

async function sendOrderConfirmation(orderId: string) {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId), with: { items: true } });
  if (!order) return;
  const lines = order.items.map(
    (i) => `- ${i.productName} / ${i.colorName} / ${i.size} × ${i.quantity}  ${formatPrice(i.unitPrice * i.quantity)}`,
  );
  await sendMail({
    to: order.email,
    subject: `fabrikadann — siparişiniz alındı (${order.number})`,
    text: [
      `Merhaba ${order.shippingAddress.fullName},`,
      "",
      `${order.number} numaralı siparişiniz alındı ve hazırlanıyor.`,
      "",
      ...lines,
      "",
      `Kargo: ${order.shippingFee === 0 ? "Ücretsiz" : formatPrice(order.shippingFee)}`,
      `Toplam: ${formatPrice(order.total)}`,
      "",
      "Kargoya verildiğinde takip numarasını ayrıca göndereceğiz.",
      `Siparişinizi buradan izleyebilirsiniz: ${appUrl}/siparis/${order.number}`,
      "",
      "Siparişinize ait ön bilgilendirme formu ve mesafeli satış sözleşmesi (onay tarihiyle birlikte):",
      `${appUrl}/on-bilgilendirme`,
      `${appUrl}/mesafeli-satis`,
      `Onay zamanı: ${order.termsAcceptedAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`,
      "",
      "fabrikadann",
    ].join("\n"),
  });
}

/** Test ödeme sayfası için: token'a ait bekleyen ödeme ve sipariş özeti. */
export async function getPendingPayment(token: string) {
  if (!token || token.length > 100) return null;
  const [row] = await db
    .select({
      token: payments.token,
      amount: payments.amount,
      status: payments.status,
      provider: payments.provider,
      orderNumber: orders.number,
      orderStatus: orders.status,
      paymentExpiresAt: orders.paymentExpiresAt,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(payments.token, token), eq(payments.status, "pending")))
    .limit(1);
  return row ?? null;
}


/**
 * Mutabakat: sonucu tarayıcı dönüşüyle gelmemiş (müşteri sekmeyi kapatmış, bağlantı kopmuş) ödemeleri
 * sağlayıcıya sorar. Bakım betiğinden, süresi dolan siparişler iptal edilmeden önce çağrılır.
 */
export async function reconcilePendingPayments(
  lookup: (providerSession: string) => Promise<PaymentOutcome | null>,
  provider: string,
): Promise<number> {
  const pending = await db
    .select({ providerSession: payments.providerSession })
    .from(payments)
    .where(
      and(
        eq(payments.provider, provider),
        eq(payments.status, "pending"),
        isNotNull(payments.providerSession),
        lt(payments.createdAt, new Date(Date.now() - 2 * 60 * 1000)),
        gt(payments.createdAt, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)),
      ),
    )
    .limit(200);
  let settled = 0;
  for (const { providerSession } of pending) {
    try {
      const outcome = await lookup(providerSession!);
      if (outcome && (await completePayment(outcome)).status !== "not_found") settled++;
    } catch (e) {
      logError("Mutabakat sorgusu başarısız", e);
    }
  }
  return settled;
}

/** Sağlayıcının ödeme oturumu kimliğinden sipariş numarası (dönüş sayfasının yönlendirmesi için). */
export async function findOrderNumberByProviderSession(provider: string, providerSession: string) {
  if (!providerSession || providerSession.length > 200) return null;
  const [row] = await db
    .select({ orderNumber: orders.number })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(payments.provider, provider), eq(payments.providerSession, providerSession)))
    .limit(1);
  return row?.orderNumber ?? null;
}
