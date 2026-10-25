// Zamanlanmış bakım (ör. 5 dakikada bir cron): npm run maintenance
// Sonucu gelmemiş ödemeleri sağlayıcıya sorar, ödeme süresi dolan siparişleri iptal edip stoğu geri koyar,
// eski oturum ve hız sınırı kayıtlarını siler.
import "dotenv/config";
import { pool } from "@/server/db";
import { releaseExpiredOrders } from "@/server/services/orders";
import { reconcilePendingPayments } from "@/server/services/payments";
import { retrieveIyzicoOutcome } from "@/server/payments/iyzico";
import { pruneSessions } from "@/server/auth/session";
import { pruneRateLimits } from "@/server/auth/rate-limit";

let reconciled = 0;
if (process.env.PAYMENT_PROVIDER === "iyzico") {
  // İptalden ÖNCE: parası çekilmiş sipariş yanlışlıkla iptal edilmesin
  reconciled = await reconcilePendingPayments(retrieveIyzicoOutcome, "iyzico");
}
const released = await releaseExpiredOrders();
await pruneSessions();
await pruneRateLimits();
console.log(`[bakım] ${new Date().toISOString()} mutabakat: ${reconciled}, süresi dolan sipariş: ${released}`);
await pool.end();
