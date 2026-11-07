# Ayarlar > API anahtarları — tasarım

Tarih: 08.11.2026 · Dal: `magaza-v1`

## Amaç

Entegrasyon anahtarlarının (Claude, N11, Trendyol, iyzico, e-posta, telefon bildirimi) durumu tek yerde görünsün;
süresi dolacak ya da çalışmayan anahtar sistemce fark edilip yöneticilerin telefonuna bildirilsin; sık değişen
anahtarlar (Claude, N11) sunucuya girmeden panelden yenilenebilsin.

**Kullanıcının isteği (07.11.2026):** Ayarlar'da API anahtarları bölümü; son kullanma durumu sistemce otomatik
kontrol edilip bildirilsin; PWA bildirimlerine eklensin. Claude anahtarı 14.11.2026'ya kadar geçerli.

## Kapsam

- **Panelden yenilenebilen:** Claude (`ANTHROPIC_API_KEY`), N11 (`N11_API_KEY` + `N11_API_SECRET`). Trendyol,
  ileride siteden Trendyol'a yükleme işiyle aynı yapıya alınacak (şimdi yalnızca durum).
- **Yalnızca durum ve son kullanma takibi:** Trendyol, iyzico, SMTP, Web Push (bunlar sunucu dosyasında kalır).
- Kapsam dışı: anahtar sağlayıcılardan son kullanma tarihini otomatik okuma (API'ler vermiyor; tarih yöneticiden).

## Güvenlik

- Panelden girilen anahtarlar veritabanında AES-256-GCM ile şifreli (`integration_secrets.ciphertext`, rastgele IV,
  kimlik doğrulama etiketi). Ana anahtar `SECRETS_KEY` (32 bayt, base64; sunucuda üretilir, yalnızca `.env.production`
  ve compose `environment:`). `SECRETS_KEY` yoksa panelden giriş kapalı ("sunucuda SECRETS_KEY tanımlayın").
- Panel anahtarın kendisini asla göstermez: yalnızca kaynak (panel / sunucu dosyası), son 4 karakter, girilme tarihi.
  Kaydetme formu boş gelir; parola alanları gibi hata sonrası geri doldurulmaz.
- Öncelik: panelde kayıtlı değer > ortam değişkeni. Panel kaydını silmek ortam değerine döner.
- Kaydetmeden önce anahtar denenir (ücretsiz istek: Claude `GET /v1/models`, N11 `GET /ms/product-query?size=1`);
  başarısızsa kaydedilmez, sağlayıcının mesajı gösterilir.
- Her değişiklik işlem günlüğüne (`integration.secret_set` / `integration.secret_cleared`) — değer yazılmaz.
- `requireAdmin` + `assertAdmin` + zod + `rateLimit` (saatte 30).

## Veri (migration 0017)

- `integration_secrets` (`name` PK — `ANTHROPIC_API_KEY`, `N11_API_KEY`, `N11_API_SECRET`; `ciphertext` text,
  `last4`, `updated_at`, `updated_by`).
- `integrations` (`id` PK — `claude`, `n11`, `trendyol`, `iyzico`, `smtp`, `webpush`; `expires_at` date null,
  `checked_at`, `ok` boolean null, `message` text null).
- `notification_kind` enum'a `integration`.

## Birimler

- `src/server/secrets.ts` — `encryptSecret`, `decryptSecret`, `getSecret(name)` (DB > env; 60 sn bellek önbelleği,
  kayıtta temizlenir), `secretStatus(name)`.
- `src/server/services/admin/integrations.ts` — `listIntegrations()` (kaynak, son 4, son kullanma, son kontrol),
  `saveIntegrationKeys(ctx, id, values, tester)`, `clearIntegrationKeys(ctx, id)`, `setExpiry(ctx, id, date|null)`.
- `src/server/integrations/health.ts` — `checkIntegrations({ now, testers })`: her entegrasyon için yapılandırılmış mı,
  sağlık denemesi (Claude, N11, Trendyol ücretsiz okuma; iyzico/SMTP/Web Push yalnızca yapılandırma), son kullanma
  eşikleri; sonuç `integrations`'a yazılır; bildirim kutusuna `integration` türünde:
  - son kullanmaya 7, 3, 1 gün kala ve geçtiğinde: dedupe `integration:{id}:expiry:{eşik}:{tarih}`;
  - denemesi başarısız olduğunda (önceki başarılıyken ya da günde bir): `integration:{id}:fail:{YYYY-MM-DD}`.
  Bildirim: "Claude API anahtarının süresi 3 gün sonra doluyor" / "N11 bağlantısı çalışmıyor: …", adres
  `/yonetim/ayarlar/api-anahtarlari`.
- Bakım betiği (5 dk) kontrolü saatte bir çalıştırır (`integrations.checked_at`'e bakarak).
- Kullanan yerler `getSecret`'e geçer: `assistantClient`, `n11Config` (async `n11ConfigAsync`), sayfalardaki
  "etkin mi" kontrolleri.

## Ekran

`/yonetim/ayarlar/api-anahtarlari` (Ayarlar'dan bağlantı): her entegrasyon için satır — ad, ne işe yaradığı, durum
(Çalışıyor / Çalışmıyor: neden / Tanımlı değil), kaynak ve son 4 karakter, son kullanma tarihi (düzenlenebilir),
son kontrol zamanı, "Şimdi kontrol et". Claude ve N11 için "Anahtarı değiştir" formu (parola alanları) ve "Paneldeki
anahtarı kaldır". Süresi 7 günden az kalan ya da çalışmayan satır `bg-caution/5` + uyarı işareti.

## Test

- Şifreleme: çözülen değer aynı; farklı IV; bozuk metin hata; anahtar yoksa kayıt reddedilir.
- `getSecret`: panel > env; kaldırınca env.
- `saveIntegrationKeys`: deneme başarısızsa kaydetmez; değer günlüğe yazılmaz; son 4 doğru.
- `checkIntegrations`: 7/3/1/0 gün eşikleri birer kez bildirim; başarısız deneme günde bir bildirim; çalışıyor durumu yazılır.
- Kullanan yerler: asistan panel anahtarıyla çalışır.
