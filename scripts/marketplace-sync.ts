// Pazaryeri (N11) ortak stok senkronu (2 dakikada bir cron): npm run marketplace:sync
// N11 siparişlerini stoktan düşer / iptalleri geri koyar, yeni siparişleri onaylar, stok ve fiyatı N11'e gönderir.
// N11_API_KEY / N11_API_SECRET tanımlı değilse hiçbir şey yapmaz.
import "dotenv/config";
import { pool } from "@/server/db";
import { describeError } from "@/server/log";
import { N11Client, n11Config } from "@/server/marketplaces/n11/client";
import { dispatchPending } from "@/server/notifications/dispatch";
import { runN11Sync } from "@/server/services/marketplace-sync";

let exitCode = 0;
try {
  const cfg = n11Config();
  if (!cfg) {
    console.log("[n11] bağlantı tanımlı değil; atlandı");
  } else {
    const summary = await runN11Sync({ client: new N11Client(cfg) });
    console.log(summary ? `[n11] ${new Date().toISOString()} ${JSON.stringify(summary)}` : "[n11] önceki çalıştırma sürüyor; atlandı");
    if (summary?.pushErrors.length) exitCode = 1;
    // Yeni N11 siparişleri ve stok uyarıları yöneticilerin telefonuna
    await dispatchPending().catch((e) => console.error("[n11] bildirim gönderilemedi:", describeError(e).split("\n")[0]));
  }
} catch (e) {
  console.error("[n11] senkron başarısız:", describeError(e).split("\n")[0]);
  exitCode = 1;
} finally {
  await pool.end();
}
process.exit(exitCode);
