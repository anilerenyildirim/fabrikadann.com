# Yönetim PWA'sı ve anlık bildirimler — tasarım

Tarih: 07.11.2026 · Dal: `magaza-v1`

## Amaç

Sipariş geldiğinde mağaza sahipleri bilgisayar başında olmasa da hemen haberdar olsun. Yönetim paneli telefona
"Fabrikadann Yönetim" uygulaması olarak eklenir ve anlık bildirim alır. Bu, Fabrikadann App çıkana kadar
kullanılacak ara çözümdür; bildirim altyapısı uygulama ve yeni pazaryerleri (N11, Hepsiburada) için de kullanılır.

**Kullanıcının söyledikleri:** iPhone ve Android karışık; bildirimler: sitede yeni sipariş, iade gerekli,
Trendyol'da yeni sipariş, stok azaldı/bitti (eşik Ayarlar'dan); N11/Hepsiburada sipariş okuması gelince aynı yere
bağlansın ("tek platform tüm kontrol"); uygulama mevcut paneli açsın; müşteriler kesinlikle erişememeli; tam
Trendyol ortak stok senkronu açılsın, ama önce stoklar karşılaştırılsın.

**Başarı ölçütü:** sitede ya da Trendyol'da sipariş geldiğinde, uygulamayı ekleyip bildirimi açmış her yöneticinin
telefonuna en geç birkaç dakika içinde (site siparişinde saniyeler içinde) bildirim gelir; dokununca ilgili sayfa açılır.

## Kapsam dışı

Çevrimdışı panel, sayfa önbelleği, kişiye göre bildirim türü seçimi, yeni mobil ekranlar, N11/Hepsiburada senkronu
(ayrı iş; burada yalnızca bağlanacakları yapı hazırlanır).

## Güvenlik

- Manifest ve service worker `/yonetim/` altında, kapsamı `/yonetim/`. Vitrin sayfalarında manifest bağlantısı yok.
  Uygulamayı yükleyen biri yalnızca yönetim giriş ekranını görür (parola + iki adımlı doğrulama).
- Abonelik ekleme/silme ve deneme bildirimi Server Action'larla yapılır; her biri `requireAdmin` ile başlar, girdi
  zod ile doğrulanır, `rateLimit` ile sınırlanır. Abonelik, onu açan yöneticinin hesabına bağlanır.
- Abonelik uç noktası yalnızca `https://` ve bilinen push servislerinin alan adları kabul edilir (Apple
  `*.push.apple.com`, Google `fcm.googleapis.com`, Mozilla `*.push.services.mozilla.com`, Microsoft
  `*.notify.windows.com`) — sunucu başka adreslere istek atmaz (SSRF yok).
- Gönderimde alıcılar her seferinde yeniden seçilir: yalnızca rolü `admin` olan kullanıcıların abonelikleri.
  Yetkisi kalkmış kullanıcının abonelikleri gönderim sırasında silinir. Push servisi 404/410 dönerse abonelik silinir.
- Panelden çıkışta o tarayıcının aboneliği silinir: çıkış formundaki küçük istemci bileşeni, form gönderilmeden
  önce `pushManager.getSubscription()` ile uç noktayı gizli `endpoint` alanına yazar ve aboneliği tarayıcıda da
  kapatır; `adminSignOutAction` bu uç noktayı yalnızca oturumdaki kullanıcıya aitse siler.
- Bildirimde kişisel veri yok: yalnızca sipariş numarası, ürün adedi, tutar, ürün/renk/numara. Müşteri adı,
  adresi, telefonu, e-postası yazılmaz. Dokununca açılan sayfa oturum kontrolünden geçer.
- Bildirim içeriği Web Push şifrelemesiyle (aes128gcm) gönderilir; VAPID özel anahtarı yalnızca
  `.env.production`'da.

## Mimari

### Veri

Yeni tablolar (migration 0012):

- `push_subscriptions`: `id`, `user_id` (users, cascade), `endpoint` (benzersiz), `p256dh`, `auth`, `label`
  (ör. "iPhone · Safari", User-Agent'tan sunucuda türetilir, 60 karakter), `created_at`, `last_success_at`.
- `notifications` (bildirim kutusu): `id`, `kind` (`order_new` | `refund_needed` | `stock_low` | `stock_out` |
  `test`), `source` (`site` | `trendyol`; ileride `n11`, `hepsiburada`), `title` (≤ 80), `body` (≤ 200), `url`
  (`/yonetim/...` ile başlamak zorunda), `dedupe_key` (benzersiz), `created_at`, `sent_at`, `attempts`, `last_error`.

Ayarlar (`settings` tablosu, `store` anahtarı): `stockAlertThreshold` (tam sayı 0–100, varsayılan 1). 0 = yalnızca
tükenince.

### Birimler

- `src/server/notifications/outbox.ts` — `enqueueNotification(tx, input)`: kutuya yazar
  (`on conflict (dedupe_key) do nothing`). İşlemi (tx) çağıran açar; bildirim olayla aynı işlemde kaydedilir.
- `src/server/notifications/stock-alert.ts` — `noteStockDrop(tx, { variantId, before, after, reference, source })`:
  eşik geçişini hesaplar ve kutuya yazar. Kural: `after === 0 && before > 0` → `stock_out`;
  `after > 0 && before > T && after <= T` → `stock_low`. Aynı işlemdeki birden çok numara tek bildirimde
  toplanır: dedupe anahtarı `stock:{reference}` (sipariş başına); işlem içinde önceki satır güncellenir.
- `src/server/notifications/push.ts` — `PushSender` arayüzü (`send(subscription, payload)` → `ok` | `gone` |
  `error`); gerçek uygulama `web-push` kütüphanesiyle; testlerde sahte. VAPID anahtarları yoksa gönderim kapalı
  (kutu dolar, gönderilmez; uyarı günlüğe bir kez yazılır).
- `src/server/notifications/dispatch.ts` — `dispatchPending({ sender, now })`: gönderilmemiş, 24 saatten genç,
  `attempts < 5` kayıtları alır (`for update skip locked`), her yönetici aboneliğine gönderir, `sent_at`/`attempts`
  günceller, `gone` abonelikleri siler. 24 saatten eski gönderilmemiş kayıtlar gönderilmeden kapanır
  (`last_error = 'süresi doldu'`). 30 günden eski kayıtlar silinir.
- `src/server/services/admin/notifications.ts` — abonelik ekle/sil/listele (kullanıcıya ait olanlar), deneme
  bildirimi.

### Olayların tetiklendiği yerler

| Olay | Yer | Dedupe | Bildirim |
|---|---|---|---|
| Sitede yeni sipariş | `completePayment`, durum `paid` | `site:order:{number}` | "Yeni sipariş FD-1234" · "2 ürün · 1.850,00 TL" → `/yonetim/siparisler/{id}` |
| İade gerekli | `completePayment`, `needs_refund`/`amount_mismatch` | `site:refund:{number}` | "İade gerekli: FD-1234" · "Ödeme alındı, sipariş karşılanamadı. iyzico'dan iade edin." |
| Trendyol'da yeni sipariş | `applyOrder`, sipariş ilk kez görülüyor ve senkron öncesine ait değil | `trendyol:order:{orderNumber}` | "Trendyol siparişi 1234567" · "3 ürün" (+ "1 numara için sitede stok yoktu") → `/yonetim/stok` |
| Stok azaldı/bitti | `takeStock` (sipariş) ve Trendyol `takeAvailable` | `stock:{reference}` | "Stok tükendi" / "Stok azaldı" · "Bot Bootie Siyah 38: 0 · …" → ürün sayfası |

Site siparişinde gönderim, `completePayment` sonunda e-postayla birlikte hemen çağrılır (`dispatchPending`, hata
yutulur ve günlüğe yazılır). Trendyol senkronu çalışma sonunda `dispatchPending` çağırır. Bakım betiği (5 dk) de
çağırır: kaçanlar en geç 5 dakikada gider. E-posta bildirimleri değişmez.

Stok bildirimi yalnızca satışlarda üretilir; elle düzeltme, sayım, alış iadesi üretmez. Site siparişinde stok
sipariş oluşturulurken ayrılır ama uyarı **ödeme alınınca** gelir (`completePayment`): ödenmeyen sipariş açarak
yöneticilere bildirim düşürülemez. Trendyol satışında uyarı stok düşülürken gelir.

İnceleme sonrası (07.11.2026): gönderim kayıtları kısa bir işlemle alır (`claimed_at`, 5 dk süre, deneme +1) ve ağ
çağrısını işlem dışında yapar; site ödemesinde gönderim route'ta yanıt sonrasına (`after()`) bırakılır; manifest
kapsamı `/yonetim`; service worker açık pencereye geçemezse yeni pencere açar.

### PWA

- Manifest: `src/app/yonetim/manifest.webmanifest/route.ts` (statik JSON; `name` "Fabrikadann Yönetim",
  `short_name` "Fabrikadann", `start_url` `/yonetim`, `scope` `/yonetim`, `display` `standalone`, `theme_color`
  ve `background_color` `#000000`/`#ffffff`, simgeler).
- Simgeler: `public/yonetim/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180), `icon-maskable-512.png`;
  logodan bir kez `scripts/make-pwa-icons.ts` (sharp) ile üretilip depoya eklenir. Bildirim simgesi ve rozet
  (`badge-96.png`, tek renk) aynı betikten.
- Yönetim düzeninin (`src/app/yonetim/layout.tsx`) metadata'sında `manifest`, `appleWebApp` (başlık, durum çubuğu)
  ve `icons.apple`. Vitrin düzenine dokunulmaz.
- Service worker: `src/app/yonetim/sw.js/route.ts` (JavaScript metni, `Cache-Control: no-cache`,
  `Content-Type: application/javascript`). Yalnızca `push` (bildirimi göster; `tag` = dedupe anahtarı, aynı olay
  tekrar gelirse üstüne yazar) ve `notificationclick` (açık panel penceresi varsa ona geçip adrese gider, yoksa
  yeni pencere; adres `/yonetim/` ile başlamıyorsa `/yonetim`). Önbellek, `fetch` dinleyicisi yok.
- Kayıt: panel düzeninde küçük istemci bileşeni service worker'ı `/yonetim/sw.js`, `scope: '/yonetim/'`,
  `updateViaCache: 'none'` ile kaydeder.
- Proxy eşleyicisi `/yonetim/sw.js` ve `/yonetim/manifest.webmanifest` için CSP başlığını eklemeye devam eder
  (zararsız); `default-src 'self'` service worker'ı ve `manifest-src 'self'` manifesti zaten kapsıyor.

### Panel: Ayarlar > Bildirimler

`/yonetim/ayarlar/bildirimler`:

- Durum satırı ve tek düğme: "Bu cihazda bildirimleri aç" / "Bu cihazda bildirimleri kapat".
- iPhone'da uygulama ana ekrandan açılmamışsa (`navigator.standalone` yok ve `PushManager` yok) düğme yerine:
  "iPhone'da bildirim için önce Safari'de Paylaş → Ana Ekrana Ekle'ye dokunun, sonra uygulamayı ana ekrandan açın."
- Tarayıcı izni reddedilmişse: "Bildirim izni kapalı. Telefonun ayarlarından Fabrikadann Yönetim için bildirimlere
  izin verin."
- "Kayıtlı cihazlarım" listesi (etiket, eklenme tarihi, son başarılı gönderim) ve her biri için "Kaldır".
- "Deneme bildirimi gönder" (yalnızca kendi cihazlarına; dedupe `test:{userId}:{dakika}`).
- Stok uyarı eşiği alanı ana Ayarlar formuna eklenir ("Stok uyarısı: bu adede ya da altına düşünce bildir").

Ortak bileşenler (`Button`, `FormNotice`, `TextField`) ve renk kuralları kullanılır.

### Trendyol ortak stok senkronunun açılması

1. Salt-okuma karşılaştırma betiği `scripts/trendyol-stock-compare.ts`: Trendyol'daki onaylı ürünlerin barkod →
   stok listesini site stoğuyla karşılaştırır; yalnızca farklı olanları ve sitede olmayanları yazar (değiştirmez).
2. Sonuç kullanıcıya gösterilir; farklar onaylanınca (ya da önce düzeltilince) cron `/etc/cron.d/fabrikadann`'a
   2 dakikada bir `trendyol:sync` eklenir. İlk çalıştırma mevcut temel çizgi (baseline) mantığıyla eski siparişlerin
   stoğunu ikinci kez düşmez ve bunlar için bildirim üretmez.

### Sunucu

- `npx web-push generate-vapid-keys` ile anahtarlar; `.env.production`'a `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT=mailto:info@fabrikadann.com`. `src/env.ts` doğrulamasına eklenir (üçü birlikte ya da hiçbiri).
  Genel anahtar istemciye Server Component'ten prop olarak verilir (`NEXT_PUBLIC_` gerekmez).
- Canlıya alma: yedek → migration 0012 → imaj → uygulama; `docs/CANLIYA-ALMA.md`'ye bildirim ve senkron adımları.

## Hata durumları

- Push servisi hatası: kayıt gönderilmemiş kalır, `attempts` artar, sonraki çalıştırmada yeniden denenir (en fazla 5).
- Abonelik süresi dolmuş (404/410): abonelik silinir; kullanıcı cihazlar listesinde onu artık görmez.
- VAPID tanımsız: bildirim gönderilmez, Bildirimler sayfası "Bildirim anahtarları sunucuda tanımlı değil" der.
- Bildirim gönderimi sipariş akışını asla bozmaz: kutuya yazma aynı işlemde (yalnızca bir INSERT), gönderim
  işlemden sonra ve hata yutularak.

## Test

Vitest, gerçek Postgres:

- `enqueueNotification` aynı dedupe anahtarıyla ikinci kez yazmaz.
- `noteStockDrop`: eşik geçişi (`3→1` T=1 → azaldı; `1→0` → tükendi; `5→4` T=1 → yok; T=0 yalnızca tükendi);
  aynı siparişteki iki numara tek bildirim.
- Sipariş ödendiğinde `order_new`, iade gerektiğinde `refund_needed` kaydı oluşur; e-posta akışı değişmez.
- Trendyol: yeni sipariş bildirim üretir; senkron öncesi sipariş ve ikinci okuma üretmez.
- `dispatchPending` (sahte sender): yalnızca admin abonelerine gider; rolü kalkmış kullanıcının aboneliği silinir;
  `gone` abonelik silinir; hata `attempts` artırır; 24 saatten eski gönderilmez.
- Abonelik action'ları: yönetici olmayan reddedilir; izin verilmeyen push alan adı reddedilir; başkasının
  aboneliği silinemez.
- Gerçek cihaz denemesi canlıda: bir iPhone (ana ekrandan) ve bir Android, "Deneme bildirimi gönder" ve gerçek
  sipariş.
