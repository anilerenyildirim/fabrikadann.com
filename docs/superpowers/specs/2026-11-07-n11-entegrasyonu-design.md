# N11 entegrasyonu — tasarım

Tarih: 07.11.2026 · Dal: `magaza-v1` · API özeti: `docs/n11-api-ozet.md` (N11 v10 belgesinden)

## Amaç

Ürünler siteden N11'e yüklenir; stok tek kaynaktan (site) yönetilir; N11 siparişleri site stoğundan düşer, iptaller
geri koyar; site ya da Trendyol satışı N11 stoğunu düşürür. Yöneticiler N11 siparişinde telefon bildirimi alır.
Yapı kanal bazlıdır: Hepsiburada aynı tablolar ve akışla eklenecek.

**Kullanıcının kararları (07.11.2026):** yön site → N11; ortak stok; N11 fiyatı varsayılan **site fiyatı + %33**
(Ayarlar'dan oran, üründe elle fiyat); hazırlama süresi **2 gün**; KDV **%10**; N11 siparişleri **otomatik onaylanır**
(stok düşülebildiyse); kategori eşleştirme **site kategorisi başına bir kez** (yönetimde).

**Doğrulanan gerçek veri (07.11.2026, salt okuma):** `GET /cdn/categories` 3722 yaprak kategori döner
(`id`, `parentId`, `name`, `subCategories`); ayakkabı kategorileri var (ör. 1001799 Kadın Bot). Kadın Bot zorunlu
özellikleri: `1 Marka` (serbest), `22 Cinsiyet` (liste), `429 Renk` (serbest, slicer), `847 Numara` (liste, varyant;
değerler 36…45 bizim numaralarla birebir). İsteğe bağlı GPSR alanları (Kayıtlı Ticari Unvan, İletişim Adresi,
E-posta, Menşei) var.

## Kapsam dışı

Ürün başlığı/görsel/özellik değişikliğinin N11'e yansıtılması (API izin vermiyor — N11 panelinden), iade akışı
(SOAP ReturnService; iadeler Trendyol'daki gibi stoğa elle eklenir), N11 kategori ağacından otomatik eşleştirme
önerisi, muhasebe dönem özetine N11 satışları (maliyet kaydı tutulur, rapor ayrı iş), Hepsiburada.

## Kimlik ve güvenlik

- Ortam: `N11_API_KEY`, `N11_API_SECRET` (ikisi birlikte ya da hiçbiri; `src/env.ts` ve
  `deploy/docker-compose.prod.yml` `environment:` listesine eklenir — eklenmezse konteyner görmez). Başlıklar
  `appkey`, `appsecret`. Adres sabit `https://api.n11.com` (sırlar yalnızca N11'e gider), `redirect: "error"`,
  30 sn zaman aşımı. Hata mesajlarında sır yazılmaz.
- N11 yanıtları zod ile doğrulanır; bozuk kayıt atlanır ve sayılır.
- Sipariş paketlerinden yalnızca stok için gerekenler saklanır (paket no, sipariş no, durum, satırlar: stockCode,
  adet, satır kimliği, satır durumu). Müşteri adı, adresi, TC kimlik, telefon **saklanmaz**.
- Yönetim ekranları ve action'lar `requireAdmin` + zod; servisler `assertAdmin`.

## Veri (migration 0014)

- `marketplace_categories` (`channel`, `external_id` bigint, `name`, `path`, PK channel+external_id) — N11 yaprak
  kategorileri önbelleği; yönetimden "Kategorileri N11'den yenile" ile dolar (aramayla seçilir).
- `marketplace_category_map` (`channel`, `category_id` → categories, `external_category_id`, `external_path`,
  `attributes` jsonb `[{ id, name, valueId?, customValue? }]` — kategoriye sabit özellikler, ör. Cinsiyet=Kadın),
  PK channel+category_id.
- `marketplace_listings` (`channel`, `variant_id` → variants cascade, `stock_code`, `product_id`, `status`
  `pending|active|failed`, `task_id`, `error`, `pushed_quantity`, `pushed_price`, `pushed_at`, `attempts`,
  `updated_at`), PK channel+variant_id, benzersiz channel+stock_code. Bir numaranın N11'deki karşılığı.
- `marketplace_tasks` (`channel`, `task_id`, `kind` `create|price_stock`, `created_at`, `checked_at`, `done`) —
  sonucu henüz okunmamış N11 görevleri.
- `marketplace_packages` (`channel`, `id`, `order_number`, `status`, `lines` jsonb
  `[{ stockCode, quantity, lineId, status }]`, `order_date`, `last_modified_at`, `updated_at`), PK channel+id.
- `marketplace_order_stock` (`channel`, `order_number`, `stock_code`, `variant_id`, `quantity`, `deducted`,
  `shortfall`, `unit_cost`, `manufacturer_id`, `cost_fixed_at`, `updated_at`), PK channel+order_number+stock_code —
  Trendyol'daki `trendyol_order_stock`'un kanal bazlı karşılığı.
- `marketplace_sync_state` (`channel` PK, `state` jsonb: cursor, baselineAt, lastRunAt, lastSuccessAt, lastError,
  lastSummary).
- `products.n11_price` (kuruş, boşsa kural).
- Ayarlar (`store`): `n11PricePercent` (0–200, varsayılan 33), `n11PreparingDay` (1–30, varsayılan 2), `n11VatRate`
  (0|1|10|20, varsayılan 10), `n11ShipmentTemplate` (≤ 100, varsayılan boş — panelde oluşturulan şablonun adı),
  `n11Brand` (≤ 60, varsayılan "Fabrikadann").

Trendyol tablolarına dokunulmaz.

## Birimler

- `src/server/marketplaces/n11/client.ts` — `N11Client` (fetch enjekte edilebilir): `categories()`,
  `categoryAttributes(id)`, `createProducts(skus)`, `updatePriceStock(items)`, `taskDetails(taskId, page)`,
  `shipmentPackages({ start, end, status, page })`, `approveLines(lineIds)`; `n11Config(env)`.
- `src/server/marketplaces/n11/listing.ts` — saf işlevler: `n11Price(product, settings)`,
  `buildSkus(product, mapping, attrs, settings, appUrl)` → `{ skus, problems }`.
- `src/server/services/admin/n11.ts` — kategori önbelleği yenileme/arama, eşleştirme kaydet/oku (kategori
  özelliklerini N11'den okuyup zorunluları gösterir), ürün listesi (gönderilebilir mi, sorunlar),
  `sendProductToN11(productId)`, durum özeti.
- `src/server/services/marketplace-sync.ts` — `runN11Sync(deps)`: advisory lock, sipariş çekme, stoğa uygulama,
  otomatik onay, görev sonuçları, stok/fiyat gönderme, bildirim.
- `src/server/services/stock.ts` — ayrılmış adet ve depo sayımı pazaryeri kargolanmamış paketlerini de kapsar.
- `scripts/marketplace-sync.ts` + cron `*/2`.

## Ürün yükleme

- **Gönderilebilir ürün:** durum `active`, kategorisi N11'e eşlenmiş, her renkte en az bir görsel, numaralarında
  SKU var. Sorunlar listede gösterilir, ürün seçilemez.
- **SKU başına:** `stockCode` = `variants.sku`; `productMainId` = ürün kimliği; `title` = "{ürün adı} {renk}"
  (≤ 100); `description` = ürün açıklaması (düz metin; HTML kaçışlı, paragraflar `<p>`); `categoryId` eşlemeden;
  `currencyType` TL; `preparingDay`, `shipmentTemplate`, `vatRate` ayarlardan; `quantity` = satılabilir stok
  (≤ 999999); `salePrice` = `listPrice` = N11 fiyatı (`(kuruş/100).toFixed(2)`); `images` = rengin görselleri
  `{APP_URL}/medya/p/{id}-1200.jpg` (https, sırayla, en fazla 8; site görselleri yalnızca WebP saklandığından
`/medya` route'u `.jpg` isteğinde aynı dosyayı sharp ile JPEG'e çevirip sunar — pazaryerleri WebP'yi kabul
etmeyebilir; yanıt değişmez ve uzun süre önbelleklenir); `barcode` yalnızca geçerli EAN-13 ve `2` ile başlamıyorsa
  (iç üretim barkodları gönderilmez).
- **Özellikler:** eşlemedeki sabit özellikler + Marka (id 1, `customValue` = `n11Brand`) + Renk (429; listede aynı
  ad varsa `valueId`, yoksa serbestse `customValue`) + Numara (adı "Numara" ya da "Beden" olan varyant özelliği;
  değer `38,5`→`38.5` normalize edilip listede aranır) + ayarlarda doluysa GPSR alanları (Kayıtlı Ticari Unvan,
  İletişim Adresi, E-posta; adla bulunur). Zorunlu bir özellik karşılanamazsa o SKU gönderilmez, sorun gösterilir.
- **N11 fiyatı:** `products.n11_price` ?? site fiyatı × (1 + oran/100), tam liraya yukarı yuvarlanır.
- Gönderim ürün başına bir istek (Trendyol aktarma ekranındaki gibi ilerleme çubuğu; en fazla 8 ürün seçilir).
  Görev kimliği `marketplace_tasks`'a, SKU'lar `marketplace_listings`'e `pending` yazılır. Sonuç senkronda okunur:
  `SUCCESS` → `active`, başarısız → `failed` + N11'in nedeni. `failed` SKU yeniden gönderilebilir.
- Sonradan eklenen numara/renk: ürün yeniden gönderilir; yalnızca listelenmemiş SKU'lar oluşturulur.

## Senkron (2 dakikada bir)

1. **Siparişler:** `orderByField=true` ile son güncellenme penceresi (imleç − 15 dk, en fazla 30 gün geriye;
   ilk çalıştırmada son 30 gün = temel çizgi), 7 durumun her biri ayrı sorgu, sayfa 100. Paketler kaydedilir
   (`last_modified_at` eskiyse üzerine yazılmaz).
2. **Stoğa uygulama** (sipariş başına, Trendyol `applyOrder` ile aynı kural): istenen adet = `Cancelled`,
   `UnSupplied` ve `UnPacked` (bölünmüş paketin aslı; satırları yeni paketlerde) dışındaki paketlerin satırları.
   Fazlası düşülür (yettiği kadar; eksik `shortfall`), azalırsa geri konur. Temel çizgiden önce verilmiş sipariş
   stok değiştirmeden "zaten düşülmüş" sayılır. stockCode → `variants.sku` ile eşleşir; eşleşmeyen satır listelenir.
3. **Bildirim:** ilk kez görülen, temel çizgiden sonraki sipariş → `order_new` (`source: n11`,
   `n11:order:{orderNumber}`, "N11 siparişi {no}", "{adet} ürün[ · {n} adet için sitede stok yoktu]",
   `/yonetim/stok`); stok düşüşü → `noteStockDrop(source: "n11")`.
4. **Otomatik onay:** `Created` durumundaki paketlerin satırları, siparişte eksik (`shortfall`) yoksa
   `approveLines` ile `Picking` yapılır; eksik varsa onaylanmaz (bildirim zaten gitti), panelde görünür.
5. **Görev sonuçları:** `marketplace_tasks`'taki açık görevler `taskDetails` ile okunur; `PROCESSED` olanların
   SKU sonuçları listelere yazılır; 24 saati aşan görev kapatılır.
6. **Stok ve fiyat gönderme:** `active` listelerde satılabilir stok ya da N11 fiyatı son gönderilenden farklıysa
   (ya da numara/ürün silindi/arşivlendiyse 0) `updatePriceStock` (1000'lik parçalar); görev kaydı tutulur, başarısız
   gönderim 15 dk sonra yeniden denenir.
7. Durum `marketplace_sync_state`'e yazılır; sonunda `dispatchPending`.

Ayrılmış adet (depo sayımı): `Created`, `Picking` paketleri kargolanmamış sayılır (Trendyol'daki gibi).

## Yönetim ekranları

- **Ayarlar > N11** bölümü: fiyat oranı, hazırlama günü, KDV, kargo şablonu adı, marka; bağlantı durumu (anahtar
  tanımlı mı) ve son senkron.
- **Kategoriler > N11 eşleştirme** (`/yonetim/kategoriler/n11`): her site kategorisi için N11 kategorisi (arama),
  seçilince o kategorinin zorunlu ve isteğe bağlı sabit özellikleri (liste ise seçim, serbestse metin); Renk, Numara,
  Marka ve GPSR otomatik doldurulduğu için gösterilmez.
- **Ürünler > N11'e gönder** (`/yonetim/urunler/n11`): ürün listesi (durum: gönderilmedi / bekliyor / N11'de /
  hata + neden), seçip gönder, ilerleme çubuğu; Trendyol listesindeki gibi gönderilmemiş ya da hatalı satırlar
  `bg-caution/5` + uyarı işareti.
- **Ürün düzenleme:** "N11 fiyatı (boşsa kural)" alanı.
- **Stok sayfası:** "N11 senkronu" bölümü (son çalıştırma, hata, stok yetmeyen siparişler, eşleşmeyen stok kodları).

## Hata durumları

- N11 erişilemez / 5xx: çalıştırma hata kaydeder, imleç ilerlemez, sonraki çalıştırma yeniden dener.
- Görev `REJECT`: listeler `failed` + neden.
- Ayarlarda kargo şablonu boşsa gönderim "N11 panelinde Hesabım > Teslimat Bilgilerim'de bir kargo şablonu
  oluşturup adını Ayarlar > N11'e yazın." hatasıyla durur.
- Anahtarlar tanımsızsa N11 ekranları bağlantı yok uyarısı gösterir; senkron hiçbir şey yapmaz.

## Test

Vitest + gerçek Postgres + sahte N11 (fetch taklidi, Trendyol testlerindeki gibi):
- İstemci: başlıklar `appkey`/`appsecret`, sır hata mesajında yok, bozuk kayıt atlanır.
- `buildSkus`: fiyat kuralı ve elle fiyat, fiyat biçimi `"1330.00"`, numara eşleme (`38,5`), renk valueId/customValue,
  zorunlu özellik eksikse sorun, görselsiz renk sorun, iç barkod gönderilmez, başlık 100 karakter.
- Gönderim: SKU'lar `pending`, görev kaydı; ikinci gönderimde yalnızca yeni SKU'lar; şablon boşsa hata.
- Senkron: ilk çalıştırma temel çizgi (stok değişmez, bildirim yok); yeni sipariş düşer + bildirim + onay; iptal geri
  koyar; `UnPacked` iki kez düşmez; stok yetmezse eksik + onay yok; eşleşmeyen stockCode listelenir; görev sonucu
  `active`/`failed`; stok değişince gönderim, değişmeyince gönderim yok; arşivlenen ürüne 0.
- Depo sayımı N11 kargolanmamış adetleri ayrılmış sayar.
- Canlı doğrulama: kategori ve özellik okuma gerçek API'ye karşı (yapıldı); ürün yükleme ve sipariş kullanıcının
  anahtar sırrı ve kargo şablonu girildikten sonra tek ürünle.
