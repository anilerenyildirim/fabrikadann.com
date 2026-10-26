import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

const { orders, passwordResetTokens, emailVerificationTokens, auditLog, carts, users } = schema;

const DAY = 24 * 60 * 60 * 1000;
/** KVKK aydınlatma metnindeki süreler (src/app/(magaza)/(kurumsal)/kvkk) ile aynı olmalı */
export const UNPAID_ORDER_RETENTION_DAYS = 30;
export const AUDIT_IP_RETENTION_DAYS = 365;
export const GUEST_CART_RETENTION_DAYS = 60;
export const UNVERIFIED_ACCOUNT_RETENTION_DAYS = 7;

export const ANONYMIZED_EMAIL_DOMAIN = "silindi.invalid";

/**
 * Saklama süresi dolan kişisel verileri siler ya da anonimleştirir (bakım betiğinden çağrılır).
 * Ödenmiş siparişlere dokunulmaz: fatura ve tüketici mevzuatı kayıt saklamayı gerektirir.
 */
export async function applyRetention(now = new Date()) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  // Kullanılmış ya da süresi dolmuş parola sıfırlama bağlantıları
  const resetTokens = await db
    .delete(passwordResetTokens)
    .where(or(isNotNull(passwordResetTokens.usedAt), lt(passwordResetTokens.expiresAt, ago(1))))
    .returning({ id: passwordResetTokens.idHash });

  // Ödemesi hiç alınmamış, iptal edilmiş siparişlerde kişisel veriler
  const anonymized = await db
    .update(orders)
    .set({
      email: sql`'anonim-' || left(${orders.id}::text, 8) || '@' || ${ANONYMIZED_EMAIL_DOMAIN}`,
      shippingAddress: { fullName: "Silindi", phone: "", city: "", district: "", line: "" },
      guestAccessHash: null,
      termsAcceptedIp: null,
    })
    .where(
      and(
        eq(orders.status, "cancelled"),
        isNull(orders.paidAt),
        lt(orders.updatedAt, ago(UNPAID_ORDER_RETENTION_DAYS)),
        sql`${orders.email} not like ${`%@${ANONYMIZED_EMAIL_DOMAIN}`}`,
      ),
    )
    .returning({ id: orders.id });

  // Güvenlik kayıtlarındaki IP adresleri
  const auditIps = await db
    .update(auditLog)
    .set({ ip: null })
    .where(and(isNotNull(auditLog.ip), lt(auditLog.createdAt, ago(AUDIT_IP_RETENTION_DAYS))))
    .returning({ id: auditLog.id });

  // Başarısız giriş kayıtlarındaki e-posta adresleri (hedef alanı) aynı sürede silinir
  await db
    .update(auditLog)
    .set({ target: null })
    .where(
      and(
        sql`${auditLog.action} like 'admin.login.%'`,
        isNotNull(auditLog.target),
        lt(auditLog.createdAt, ago(AUDIT_IP_RETENTION_DAYS)),
      ),
    );

  // Terk edilmiş misafir sepetleri
  const guestCarts = await db
    .delete(carts)
    .where(and(isNull(carts.userId), lt(carts.updatedAt, ago(GUEST_CART_RETENTION_DAYS))))
    .returning({ id: carts.id });

  // Kullanılmış ya da süresi dolmuş e-posta doğrulama bağlantıları
  const verifyTokens = await db
    .delete(emailVerificationTokens)
    .where(or(isNotNull(emailVerificationTokens.usedAt), lt(emailVerificationTokens.expiresAt, ago(1))))
    .returning({ id: emailVerificationTokens.idHash });

  // Doğrulanmadan bırakılmış, siparişi olmayan müşteri hesapları
  const unverified = await db
    .delete(users)
    .where(
      and(
        eq(users.role, "customer"),
        isNull(users.emailVerifiedAt),
        lt(users.createdAt, ago(UNVERIFIED_ACCOUNT_RETENTION_DAYS)),
        sql`not exists (select 1 from ${orders} where ${orders.userId} = ${users.id})`,
      ),
    )
    .returning({ id: users.id });

  return {
    resetTokens: resetTokens.length,
    verifyTokens: verifyTokens.length,
    unverifiedAccounts: unverified.length,
    anonymizedOrders: anonymized.length,
    auditIps: auditIps.length,
    guestCarts: guestCarts.length,
  };
}
