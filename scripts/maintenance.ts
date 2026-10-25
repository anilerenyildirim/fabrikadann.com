// Zamanlanmış bakım (ör. 5 dakikada bir cron): npm run maintenance
// Ödeme süresi dolan siparişleri iptal edip stoğu geri koyar, eski oturum ve hız sınırı kayıtlarını siler.
import "dotenv/config";
import { pool } from "@/server/db";
import { releaseExpiredOrders } from "@/server/services/orders";
import { pruneSessions } from "@/server/auth/session";
import { pruneRateLimits } from "@/server/auth/rate-limit";

const released = await releaseExpiredOrders();
await pruneSessions();
await pruneRateLimits();
console.log(`[bakım] ${new Date().toISOString()} süresi dolan sipariş: ${released}`);
await pool.end();
