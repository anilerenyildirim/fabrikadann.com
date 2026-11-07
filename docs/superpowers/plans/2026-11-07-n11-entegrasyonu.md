# N11 entegrasyonu — uygulama planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Site ürünlerini N11'e yüklemek, stok/fiyatı eşitlemek, N11 siparişlerini site stoğundan düşmek ve bildirmek.

**Architecture:** Kanal bazlı `marketplace_*` tabloları (Trendyol tablolarına dokunulmaz). `N11Client` (fetch enjekte) + saf `buildSkus` + yönetim servisi (eşleştirme, gönderim) + `runN11Sync` (Trendyol `runTrendyolSync` ile aynı kalıp: advisory lock, sipariş → stok, görev sonuçları, stok gönderme). Cron 2 dk.

**Tech Stack:** Next.js 16, Drizzle/Postgres, Vitest (gerçek DB + sahte fetch), sharp.

**Spec:** `docs/superpowers/specs/2026-11-07-n11-entegrasyonu-design.md` · API: `docs/n11-api-ozet.md`

## Global Constraints

- Kurallar CLAUDE.md: tema renkleri (+ `bg-caution/5` yalnızca yönetimde eksik satırlar), `min-h-11`, Türkçe metin, zod + `requireAdmin`/`assertAdmin`, kuruş tamsayı.
- N11 adresi sabit `https://api.n11.com`; başlıklar `appkey`, `appsecret`; `redirect: "error"`; 30 sn zaman aşımı; hata mesajında sır yok.
- Müşteri kişisel verisi saklanmaz (paket: id, orderNumber, status, lines{stockCode, quantity, lineId, status}, tarihler).
- Fiyat biçimi `(kurus/100).toFixed(2)`; `listPrice` = `salePrice`.
- Yeni ortam değişkeni `src/env.ts` **ve** `deploy/docker-compose.prod.yml` `environment:` listesine eklenir.
- Varsayılanlar: oran 33, hazırlama 2, KDV 10, marka "Fabrikadann", şablon boş.
- Senkron imleci: overlap 15 dk, en fazla 30 gün geri; tek seferde en fazla 20 sayfa/durum.
- Yorumlar Türkçe, tanımlayıcılar İngilizce.

## Review Focus

1. Aynı sipariş iki çalıştırmada ya da hem `UnPacked` aslı hem bölünmüş paketlerde görünürse stok iki kez düşmemeli → Task 6 testi.
2. Temel çizgi (ilk çalıştırma) eski siparişleri düşmemeli ve bildirmemeli → Task 6 testi.
3. N11'e iç üretim barkodu (`29…`) ya da WebP görsel gitmemeli → Task 4 testi.
4. Stok yetmeyen sipariş N11'de onaylanmamalı → Task 6 testi.
5. Kargo şablonu boşken gönderim N11'e istek atmadan anlaşılır hatayla durmalı → Task 5 testi.

---

### Task 1: Şema, migration 0014, ortam, ayarlar

**Files:** `src/server/db/schema.ts`, `drizzle/0014_n11.sql`, `src/env.ts`, `deploy/docker-compose.prod.yml`, `src/server/services/settings.ts`, `tests/helpers/db.ts` (TRUNCATE listesi), `tests/services/settings.test.ts`

**Produces:** tablolar `marketplaceCategories`, `marketplaceCategoryMap`, `marketplaceListings` (status enum `marketplace_listing_status` pending|active|failed), `marketplaceTasks`, `marketplacePackages` (type `MarketplaceLine = { stockCode: string; quantity: number; lineId: string; status: string }`), `marketplaceOrderStock`, `marketplaceSyncState`; `products.n11Price`; ayarlar `n11PricePercent`, `n11PreparingDay`, `n11VatRate`, `n11ShipmentTemplate`, `n11Brand`.

- [ ] Test `N11 ayar varsayılanları; KDV yalnızca 0/1/10/20` → RED → şema/ayar/env/compose → `npm run db:generate -- --name n11` → migrate → GREEN → commit `feat: N11 tablolari ve ayarlari`.

### Task 2: JPEG görsel adresi

**Files:** `src/server/storage/images.ts` (`readMediaFile` `.jpg` kabul; `mediaJpegUrl(key, width)`), `src/app/medya/[...path]/route.ts` (içerik türü uzantıya göre), `tests/services/images.test.ts` (varsa genişlet, yoksa oluştur)

- [ ] Test `p/<id>-1200.jpg isteği JPEG döner; bilinmeyen uzantı null` → RED → `.jpg` için webp dosyasını `sharp().jpeg({ quality: 85 })` ile çevir → GREEN → commit.

### Task 3: N11 istemcisi

**Files:** `src/server/marketplaces/n11/client.ts`, `tests/services/n11-client.test.ts`

**Produces:** `n11Config(source = process.env): N11Config | null` (ikisi birlikte; eksikse hata), `class N11Error`, `class N11Client(cfg, fetchImpl)` ile:
- `categories(): Promise<{ id: number; path: string }[]>` (yalnız yapraklar, `path` "A > B > C")
- `categoryAttributes(id): Promise<N11Attribute[]>` (`{ id, name, mandatory, variant, custom, values: { id, value }[] }`)
- `createProducts(skus: N11Sku[]): Promise<{ taskId: string | null; status: string; reasons: string[] }>`
- `updatePriceStock(items: { stockCode: string; quantity?: number; price?: number }[])` → aynı dönüş
- `taskDetails(taskId): Promise<{ status: string; skus: { stockCode: string; ok: boolean; reasons: string[] }[] }>` (tüm sayfalar)
- `shipmentPackages({ start, end, status, page }): Promise<{ packages: N11Package[]; skipped: number; totalPages: number }>` (`orderByField=true`, `orderByDirection=ASC`, `size=100`)
- `approveLines(lineIds: string[]): Promise<{ lineId: string; ok: boolean; reason: string }[]>`

- [ ] Testler (sahte fetch): `başlıklar appkey/appsecret, adres api.n11.com`; `hata mesajında sır yok`; `kategori ağacından yalnız yapraklar yol adıyla`; `bozuk paket atlanır ve sayılır, müşteri alanları alınmaz`; `fiyat 2 ondalıklı gönderilir` → RED → implement → GREEN → commit.

### Task 4: SKU oluşturucu (saf)

**Files:** `src/server/marketplaces/n11/listing.ts`, `tests/services/n11-listing.test.ts`

**Produces:** `n11PriceOf(sitePrice: number, override: number | null, percent: number): number` (tam liraya yukarı); `buildSkus(input: { product: { id, name, description, price, n11Price, colors: { name, images: string[] /*storageKey*/, variants: { sku, size, stock, barcode }[] }[] }; mapping: { externalCategoryId: number; attributes: MappedAttr[] }; attributes: N11Attribute[]; settings; company: { name, address, email }; appUrl: string; only?: Set<string> }): { skus: N11Sku[]; problems: { stockCode: string | null; reason: string }[] }`.

- [ ] Testler: `fiyat kuralı %33 ve elle fiyat`; `"1330.00" biçimi`; `numara 38,5 → 38.5 listede valueId`; `liste dışı numara sorun`; `renk listede varsa valueId yoksa customValue`; `zorunlu sabit özellik eksikse sorun`; `görselsiz renk sorun`; `29 ile başlayan barkod gönderilmez, geçerli EAN-13 gönderilir`; `görseller https .jpg en fazla 8`; `başlık ≤ 100`; `only verilirse yalnız o SKU'lar` → RED → implement → GREEN → commit.

### Task 5: Yönetim servisi

**Files:** `src/server/services/admin/n11.ts`, `tests/yonetim/n11.test.ts`

**Produces:** `refreshN11Categories(ctx, client)`, `searchN11Categories(q)`, `getCategoryMappings()`, `getN11CategoryAttributes(ctx, client, externalId)`, `saveCategoryMapping(ctx, client, raw)` (zorunlu sabit özellikler kontrolü; Renk/Numara/Marka/GPSR dışındaki zorunlular), `listN11Products()` (ürün, eşleşme, durum sayıları, sorunlar), `sendProductToN11(ctx, client, productId)` → `{ status: "sent" | "nothing" | "failed"; sent: number; problems; message? }`.

- [ ] Testler: `kategori yenileme önbelleği değiştirir`; `eşlemede zorunlu Cinsiyet yoksa hata`; `şablon boşken gönderim N11'e istek atmaz`; `gönderim SKU'ları pending ve görev kaydı`; `ikinci gönderim yalnız yeni SKU`; `failed SKU yeniden gönderilir`; `yönetici olmayan reddedilir` → RED → implement → GREEN → commit.

### Task 6: Senkron + ayrılmış stok + betik

**Files:** `src/server/services/marketplace-sync.ts`, `src/server/services/stock.ts` (`marketplaceReservedByVariant`, `settleMarketplaceForCount` ve mevcut toplamlara eklenmesi), `scripts/marketplace-sync.ts`, `package.json` (`marketplace:sync`), `Dockerfile` (betik kopyası), `src/server/notifications/outbox.ts` (kaynak tipi zaten n11 içerir), `tests/services/n11-sync.test.ts`

**Produces:** `runN11Sync({ client, now?, pause? }): Promise<N11SyncSummary | null>`; `getN11Status()` (yönetim için: son çalıştırma, hata, eksikler, eşleşmeyenler).

- [ ] Testler: `ilk çalıştırma temel çizgi: stok değişmez, bildirim yok`; `yeni sipariş düşer, order_new yazılır, Created satırları onaylanır`; `ikinci okuma tekrar düşmez`; `iptal geri koyar`; `UnPacked aslı + bölünmüş paket bir kez düşer`; `stok yetmezse eksik, onay yok, bildirimde eksik yazar`; `eşleşmeyen stockCode durumda listelenir`; `görev sonucu SUCCESS → active, Fail → failed + neden`; `stok değişince updatePriceStock, değişmezse yok`; `arşivlenen ürüne 0`; `depo sayımı N11 kargolanmamış adedi ayrılmış sayar`; `aynı anda iki çalıştırmadan biri atlanır` → RED → implement → GREEN → full suite → commit.

### Task 7: Yönetim ekranları

**Files:** `src/app/yonetim/(panel)/ayarlar/*` + `SettingsForm` (N11 grubu), `src/app/yonetim/(panel)/kategoriler/n11/{page.tsx,actions.ts}` + `src/components/admin/N11CategoryMapForm.tsx`, `src/app/yonetim/(panel)/urunler/n11/{page.tsx,actions.ts}` + `src/components/admin/N11SendForm.tsx` (TrendyolImportForm kalıbı), ürün düzenleme N11 fiyatı (`src/server/services/admin/catalog.ts` `n11Price` alanı), Stok sayfası N11 bölümü, Ürünler/Kategoriler sayfalarına bağlantılar.

- [ ] `npx tsc --noEmit`, `npm run build`, `npm test` → commit.

### Task 8: Belgeler ve canlı

**Files:** `docs/CANLIYA-ALMA.md` (§5e N11), `CLAUDE.md` (mimari satırı).

- [ ] Commit; canlı: yedek → imaj → migration 0014 → `N11_API_KEY/SECRET` `.env.production` (kullanıcıdan sır gelince) → kategorileri yenile → kullanıcı kargo şablonu adını girer → tek ürünle deneme → cron `*/2` marketplace-sync.
