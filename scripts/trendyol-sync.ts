// Trendyol ortak stok senkronu (ör. 2 dakikada bir cron): npm run trendyol:sync
// Trendyol siparişlerini stoktan düşer / iptalleri geri koyar, değişen stokları Trendyol'a gönderir.
// TRENDYOL_* ortam değişkenleri tanımlı değilse hiçbir şey yapmaz.
import "dotenv/config";
import { pool } from "@/server/db";
import { describeError } from "@/server/log";
import { runTrendyolSync } from "@/server/services/trendyol";
import { TrendyolClient, trendyolConfig } from "@/server/trendyol/client";

let exitCode = 0;
try {
  const cfg = trendyolConfig();
  if (!cfg) {
    console.log("[trendyol] bağlantı tanımlı değil; atlandı");
  } else {
    const summary = await runTrendyolSync({ client: new TrendyolClient(cfg) });
    console.log(
      summary
        ? `[trendyol] ${new Date().toISOString()} ${JSON.stringify(summary)}`
        : "[trendyol] önceki çalıştırma sürüyor; atlandı",
    );
    if (summary?.pushErrors.length) exitCode = 1;
  }
} catch (e) {
  console.error("[trendyol] senkron başarısız:", describeError(e).split("\n")[0]);
  exitCode = 1;
} finally {
  await pool.end();
}
process.exit(exitCode);
