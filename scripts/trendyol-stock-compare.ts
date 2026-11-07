// Salt okuma: Trendyol'daki onaylı ürünlerin stoklarını sitedekiyle karşılaştırır, hiçbir şeyi değiştirmez.
// Ortak stok senkronunu açmadan önce farkları görmek için: npm run trendyol:compare
import "dotenv/config";
import { isNotNull } from "drizzle-orm";
import { db, pool, schema } from "@/server/db";
import { TrendyolClient, trendyolConfig } from "@/server/trendyol/client";

const cfg = trendyolConfig();
if (!cfg) {
  console.log("Trendyol bağlantısı tanımlı değil.");
  process.exit(0);
}
const client = new TrendyolClient(cfg);

// Trendyol: barkod → adet (arşivlenmiş numaralar hariç)
const trendyol = new Map<string, { quantity: number; title: string }>();
for (let page = 0; ; page++) {
  const res = await client.approvedProducts({ page, size: 100 });
  for (const c of res.contents) {
    for (const v of c.variants) if (!v.archived) trendyol.set(v.barcode, { quantity: v.quantity, title: c.title.slice(0, 50) });
  }
  if (!res.hasMore) break;
}

const site = await db
  .select({ barcode: schema.variants.barcode, stock: schema.variants.stock, sku: schema.variants.sku, size: schema.variants.size })
  .from(schema.variants)
  .where(isNotNull(schema.variants.barcode));
const siteByBarcode = new Map(site.map((v) => [v.barcode!, v]));

const different: string[] = [];
const notOnSite: string[] = [];
let same = 0;
for (const [barcode, t] of trendyol) {
  const s = siteByBarcode.get(barcode);
  if (!s) {
    if (t.quantity > 0) notOnSite.push(`${barcode}\t${t.quantity}\t${t.title}`);
    continue;
  }
  if (s.stock === t.quantity) same++;
  else different.push(`${barcode}\tsite ${s.stock}\tTrendyol ${t.quantity}\t${s.sku} ${s.size}\t${t.title}`);
}
const notOnTrendyol = site.filter((v) => !trendyol.has(v.barcode!) && v.stock > 0).map((v) => `${v.barcode}\tsite ${v.stock}\t${v.sku} ${v.size}`);

console.log(`Eşleşen ve aynı: ${same}`);
console.log(`\nFarklı (${different.length}):`);
for (const l of different) console.log(l);
console.log(`\nTrendyol'da stoklu ama sitede yok (${notOnSite.length}):`);
for (const l of notOnSite) console.log(l);
console.log(`\nSitede stoklu ama Trendyol'da yok (${notOnTrendyol.length}):`);
for (const l of notOnTrendyol) console.log(l);

await pool.end();
