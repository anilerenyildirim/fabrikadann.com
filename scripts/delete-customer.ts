// KVKK silme talebi: müşteri hesabını kapatır ve kişisel verilerini siler/anonimleştirir.
//
//   npx tsx scripts/delete-customer.ts <e-posta>            (önizleme: ne yapılacağını yazar)
//   npx tsx scripts/delete-customer.ts <e-posta> --onayla   (uygular)
//
// Siparişler vergi ve tüketici mevzuatı gereği saklanır (adres ve e-posta sipariş kaydında kalır);
// hesap, adresler, oturumlar, sepet ve bekleyen bağlantılar silinir, hesap kaydı anonimleştirilir.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool, schema } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { audit } from "@/server/services/audit";

const [emailArg, flag] = process.argv.slice(2).filter((a) => a !== "--");
if (!emailArg) {
  console.error("Kullanım: npx tsx scripts/delete-customer.ts <e-posta> [--onayla]");
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();

const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
if (!user) {
  console.error(`${email} adresinde hesap yok.`);
  process.exit(1);
}
if (user.role !== "customer") {
  console.error("Bu araç yalnızca müşteri hesapları içindir.");
  process.exit(1);
}
const [{ n: orderCount }] = (
  await db.execute<{ n: number }>(sql`select count(*)::int as n from orders where user_id = ${user.id}`)
).rows as [{ n: number }];

console.log(`Hesap: ${email} — ${orderCount} sipariş (saklanır, hesaptan ayrılır)`);
if (flag !== "--onayla") {
  console.log("Önizleme. Uygulamak için --onayla ekleyin.");
  await pool.end();
  process.exit(0);
}

await db.transaction(async (tx) => {
  await tx.delete(schema.addresses).where(eq(schema.addresses.userId, user.id));
  await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
  await tx.delete(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.userId, user.id));
  await tx.delete(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, user.id));
  await tx.delete(schema.carts).where(eq(schema.carts.userId, user.id));
  if (orderCount === 0) {
    await tx.delete(schema.users).where(eq(schema.users.id, user.id));
  } else {
    // Siparişler hesaba bağlı kalır ama hesap kullanılamaz ve kişisel veri içermez
    await tx
      .update(schema.users)
      .set({
        email: `silindi-${user.id.slice(0, 8)}@silindi.invalid`,
        firstName: "Silindi",
        lastName: "",
        phone: null,
        passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
        emailVerifiedAt: null,
      })
      .where(eq(schema.users.id, user.id));
  }
  await audit({ action: "customer.deleted", target: user.id, data: { orders: orderCount } }, tx);
});
console.log("Tamam: hesap kapatıldı ve kişisel veriler silindi.");
await pool.end();
