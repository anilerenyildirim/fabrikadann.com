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
import { applyRetention } from "@/server/services/retention";
import { dispatchPending, pruneNotifications } from "@/server/notifications/dispatch";

let reconciled = 0;
if (process.env.PAYMENT_PROVIDER === "iyzico") {
  // İptalden ÖNCE: parası çekilmiş sipariş yanlışlıkla iptal edilmesin
  reconciled = await reconcilePendingPayments(retrieveIyzicoOutcome, "iyzico");
}
const released = await releaseExpiredOrders();
await pruneSessions();
await pruneRateLimits();
// KVKK: saklama süresi dolan kişisel veriler (aydınlatma metnindeki sürelerle)
const retention = await applyRetention();
// Kaçan anlık bildirimler (ör. push servisi o an yanıt vermedi) en geç 5 dakikada gider
const pushed = await dispatchPending().catch((e) => {
  console.error("[bakım] bildirim gönderilemedi:", e instanceof Error ? e.message : e);
  return null;
});
const prunedNotifications = await pruneNotifications();
console.log(
  `[bakım] ${new Date().toISOString()} mutabakat: ${reconciled}, süresi dolan sipariş: ${released}, ` +
    `imha: ${JSON.stringify(retention)}, bildirim: ${JSON.stringify(pushed)}, eski bildirim: ${prunedNotifications}`,
);
await pool.end();
