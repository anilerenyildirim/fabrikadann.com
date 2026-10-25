# Güvenlik denetimi — 26.10.2026

fabrikadann.com v1 (dal `magaza-v1`) için beyaz şapkalı güvenlik denetimi. Denetim kodu okuyarak
(statik) ve çalışan sunuculara gerçek saldırı denemeleri yaparak (dinamik) yapıldı. Dinamik testler canlı
derlemeye (`NODE_ENV=production`) ve geliştirme sunucusuna karşı koşuldu. Her bulgu, onu çürütmeye
çalışan ayrı bir doğrulayıcıdan geçti; çürütülemeyenler "doğrulandı" sayıldı ve düzeltildi.

## Özet

| Tur | Kapsam | Doğrulanan bulgu | Durum |
|---|---|---|---|
| 1 — Çekirdek | Kimlik doğrulama, sipariş/stok/ödeme, depolama, HTTP yüzeyi, dağıtım | 32 (1 yüksek, 10 orta, 21 düşük) | Hepsi kapatıldı |
| 2 — Tam site | 5 boyut: yetkilendirme, iş mantığı, girdi/çıktı, HTTP/yapılandırma, bağımlılık/KVKK | 15 (hepsi düşük) | Hepsi kapatıldı |
| 3 — Gerileme + yeni açılar | Önceki düzeltmelerin doğrulanması, e-posta doğrulama akışı, yönetim paneli, yarış koşulları, kırmızı takım | bkz. §3 | bkz. §3 |

Kritik ya da yüksek önemli bir açık şu anda bilinmiyor. Tek yüksek önemli bulgu (yedekleme komutunun
sessizce boş dosya üretmesi) kod dışı bir işletme hatasıydı ve düzeltildi.

## Uygulanan korumalar (özet)

- **Kimlik doğrulama:** argon2id (OWASP parametreleri). Parola kuralları: en az 10 karakter; yaygın parolalar, "yaygın kelime + rakam" ve klavye dizileri reddedilir. Oturum token'ı 256 bit ve veritabanında yalnızca SHA-256 özeti tutulur. Çerez `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`. Girişte oturum yenilenir (session fixation yok).
- **Hesap numaralandırma yok:** Giriş, parola sıfırlama ve kayıt aynı yanıtı verir. Kayıtta e-posta doğrulaması zorunlu; doğrulama butonla (POST) yapılır, böylece e-posta tarayıcıları bağlantıyı tüketemez.
- **Yönetim paneli:** Parolanın yanında TOTP zorunlu. Kodlar tek kullanımlık; günlük ve 5 dakikalık deneme sınırı var. TOTP anahtarları veritabanında AES-256-GCM ile şifreli. Yönetici oturumu 12 saat. Panelin her sayfası ve her işlem sunucuda `requireAdmin` ile korunur. Tüm işlemler işlem günlüğüne yazılır.
- **Hız sınırları:** Giriş, kayıt, sıfırlama, TOTP, sepet ve ödeme veritabanı tabanlı atomik sayaçla sınırlanır. E-posta sınırı IP ile birlikte tutulur (hesap kilitleme saldırısı yok). IPv6 adresleri /64 bloğuna göre sayılır. Canlıda istemci IP'si yalnızca Caddy'nin yazdığı `X-Real-IP` başlığından okunur.
- **İş mantığı:** Fiyat ve toplam yalnızca sunucuda hesaplanır. Stok koşullu tek ifadeyle düşer (aşırı satış yok; eşzamanlılık testli). Sipariş başına en fazla 10 çift; kişi başına 2, IP başına 5 açık sipariş; bir numaranın stoğunun en fazla yarısı ödenmemiş siparişlerde tutulabilir. Ödeme onayı idempotent, tutar sunucuda doğrulanır. Yöneticinin iptali geç gelen ödemeyle geri alınamaz; parası alınmış siparişin iptali "iade gerekli" olarak işaretlenir.
- **Ödeme (iyzico):** Dönüş gövdesine güvenilmez; sonuç iyzico API'sinden sunucudan sunucuya sorgulanır. Tarayıcı dönüşü gelmezse bakım betiği mutabakat yapar. Test ödemesi canlıda yalnızca yöneticiye açık.
- **Girdi/çıktı:** Her girdi zod ile doğrulanır; kontrol karakterleri (NUL vb.) temizlenir. Kullanıcı HTML'i render edilmez. JSON-LD'de `<` kaçırılır. Ayarlardaki bağlantılar yalnızca `https://`. Dönüş adresleri açık yönlendirmeye karşı süzülür.
- **Yükleme:** Yalnızca JPEG/PNG/WebP/AVIF kabul edilir, en fazla 10 MB ve 8000×8000 piksel. Görseller sharp ile yeniden kodlanır (EXIF/konum atılır); dosya adı rastgele. `/medya` yolu kesin biçim denetimiyle sunulur (yol geçişi yok).
- **HTTP:** Her istekte nonce'lu sıkı CSP (`strict-dynamic`, `frame-ancestors 'none'`, `form-action`), HSTS (preload), X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy. Server Action'larda Origin kontrolü var; route handler'larda ayrıca. Bozuk adresler 400 döner. Görsel optimize edicisi kapalı.
- **Loglar:** Veritabanı hata mesajlarındaki sorgu parametreleri (kişisel veri, parola özeti) loglanmaz. Canlıda SMTP yoksa e-posta içeriği loglara yazılmaz. Docker'da log döndürme açık.
- **Dağıtım:** Docker imajı root olmayan kullanıcıyla çalışır, kod salt okunurdur. İmajda yalnızca üretim bağımlılıkları var; `.env` ve yüklenen görseller imaja girmez. Uygulama veritabanına kısıtlı rolle bağlanır (TRUNCATE/DROP yok). Postgres dışarıya kapalı. Caddy otomatik HTTPS sağlar, gövde sınırlarını uygular ve varsayılan güvenlik başlıklarını ekler. İmaj sürümleri sabit.
- **KVKK:** Yalnızca zorunlu çerezler kullanılıyor. Aydınlatma metni veri toplama anında gösteriliyor. Saklama/imha bakım betiğinde: ödenmemiş siparişler 30 gün sonra anonimleşir, güvenlik IP kayıtları 1 yıl sonra silinir, sıfırlama bağlantıları kullanıldıktan sonra silinir.

## 1. tur — çekirdek inceleme (32 bulgu, hepsi kapatıldı)

| Kimlik | Önem | Bulgu |
|---|---|---|
| F1 | Yüksek | Gece yedeği sessizce 0 baytlık dosya üretiyordu; görseller yedeklenmiyordu |
| AUTH-01 | Orta | Cloudflare kurulumunda istemci IP'si uydurulabiliyordu (IP hız sınırları aşılıyordu) |
| AUTH-02 | Orta | E-posta başına kesin sınır, hedefli hesap kilitlemeye yol açıyordu |
| AUTH-03 | Orta | TOTP zaman içinde kaba kuvvetle kırılabilirdi (günlük sınır yoktu) |
| PAY-1 | Orta | iyzico onayı yalnızca tarayıcı dönüşüne bağlıydı; mutabakat yapılamıyordu |
| PAY-2 | Orta | Yöneticinin iptal ettiği sipariş geç gelen ödemeyle kendiliğinden canlanıyordu |
| STK-1 | Orta | Ödenmeyen siparişlerle sınırsız stok kilitlenebiliyordu |
| STK-2 | Orta | Elle stok yazımı bekleyen siparişleri hesaba katmıyordu (aşırı satış) |
| F2 | Orta | Docker imajı derlenmiyordu |
| F3 | Orta | Cloudflare başlığı doğrudan sunucuya gelen istekte uydurulabiliyordu |
| F4 | Orta | IPv6 ziyaretçileri tek IP'de toplanıyordu (tek saldırgan herkesi kilitleyebilirdi) |
| AUTH-05…13 | Düşük | IPv6 kovalama; `__Host-` çerez silme; mağaza girişinde yönetici; kayıtta numaralandırma; IP başlığı doğrulama; TOTP zaman adımı; kısa parola listesi; TOTP anahtarı düz metin |
| PAY-3, ORD-1, CRT-1 | Düşük | İncelemedeki ödemenin kalıcı "başarısız" sayılması; kilit sırası (deadlock); sepet birleştirmede satır sınırı |
| F5…F15 | Düşük | Gövde boyutu; CSP `form-action`; statik sayfalarda nonce; görsel hata mesajları ve yeniden kodlama; SMTP'siz kişisel veri logu; create-admin ile yükseltme; imajda yazılabilir kod ve geliştirme bağımlılıkları; parola URL kodlaması; görsel optimize edicisi |

## 2. tur — tam site denetimi (15 bulgu, hepsi kapatıldı)

| Kimlik | Bulgu | Düzeltme |
|---|---|---|
| AUTH-ENUM-01 | Kayıt formu e-postanın kayıtlı olup olmadığını açığa veriyordu | E-posta doğrulaması; yeni ve var olan e-postaya birebir aynı yanıt (tarayıcıda doğrulandı) |
| A04-LOW-1 | IP değiştirerek ödenmemiş siparişlerle stok kilitleme | Bir numaranın stoğunun en fazla yarısı ödenmemiş siparişlerde tutulabilir |
| F1 | `X-Forwarded-For` ile IP hız sınırının atlatılması | Canlıda varsayılan `X-Real-IP`; compose'da açık ayar; Caddy gelen XFF'yi siler |
| F2 | 13 MB gövde sınırı tüm `/yonetim` için açıktı | Yalnızca ürün düzenleme yolunda; diğer her yerde 256 KB |
| F3 | Bozuk yüzde kodlamalı adres başlıksız 500 veriyordu | Proxy'de 400; Caddy'de varsayılan güvenlik başlıkları |
| LOG-1 | Veritabanı hata loglarında kişisel veri ve parola özeti | Güvenli hata kaydedici (`src/server/log.ts`) |
| LOG-2 | `/ara?q=%00` 500 hatası ve log şişirme | Kontrol karakterleri her girdide temizleniyor |
| DEP-1 | Canlı imajda geliştirme bağımlılıkları | `npm ci --omit=dev` aşaması |
| SUP-1 | Standalone paketine `uploads/`, `tests/` giriyordu | `outputFileTracingExcludes`; `.env` Docker'da hariç (doğrulandı) |
| SCR-1 | Seed sipariş kalemlerini silebiliyordu | Sipariş varsa açık onaysız çalışmaz; canlı imajda yok |
| KVKK-1 | Saklama/imha mekanizması yoktu | `applyRetention` (bakım betiğinde) |
| KVKK-2 | Ödeme formunda aydınlatma bağlantısı yoktu; iyzico'ya aktarım eksik anlatılmıştı | Formda bilgilendirme ve bağlantı; metin güncellendi |
| KVKK-3 | Çerez politikası SameSite'ı yanlış anlatıyordu | Metin düzeltildi |
| SUP-2 | İmaj sürümleri kayan etiketlerdi | Node 24.11.1, Postgres 17.10, Caddy 2.10 sabit |
| OPS-1 | Yedekler şifresiz ve herkese okunur izinlerle yazılıyordu | `umask 077`, 14 günlük saklama, `age` ile şifreli dış kopya (belgede) |

Ek olarak, denetimin "en iyi uygulama" olarak andığı iki konu da uygulandı: uygulamanın kısıtlı
veritabanı rolü (F13'ün kalan parçası) ve tahmin edilebilir parola kuralları (AUTH-12).

## 3. tur — gerileme ve yeni açılar

_(Bu bölüm 3. tur tamamlanınca dolduruldu; aşağıya bakın.)_

## Kabul edilen kalıntı riskler

- **Ürün düzenleme yolunda 13 MB gövde:** Caddy kimlik doğrulama yapamaz. Bu yol, görsel yüklemesi için
  büyük gövde kabul eder; Next.js, `requireAdmin` kontrolünden önce gövdeyi belleğe alır. Etki, kimlik
  doğrulamasız bir bellek tüketim yüzeyiyle sınırlı. Gerekirse Caddy'de bu yol için IP başına istek sınırı
  eklenebilir.
- **Docker dışında derleme:** `next build`, `.env`'i standalone paketine kopyalar. Bu yüzden yalnızca Docker
  içinde derleme yapılmalı (belgede yazıyor; `.dockerignore` `.env`'i dışarıda bırakır).
- **Çok düşük stoklu numaralar:** 3 çift ve altındaki stok, ödenmemiş siparişlerle geçici olarak
  (30 dk) kilitlenebilir. Tamamen önlemek bot korumasıyla (ör. Cloudflare Turnstile) mümkün.

## Canlıya çıkmadan önce (güvenlikle ilgili)

- iyzico sandbox ile uçtan uca deneme: başarılı, başarısız, 3DS'de pencere kapatma (mutabakatın çalıştığını görmek için).
- `SESSION_SECRET`, `POSTGRES_PASSWORD` ve `APP_DB_PASSWORD` için uzun rastgele değerler. Sırlar yalnızca sunucudaki `.env.production` dosyasında.
- Cloudflare kullanılacaksa `deploy/Caddyfile`'daki `trusted_proxies` bloğunu açın.
- Yalnızca A kaydı (IPv6 için Docker yapılandırması yapılmadan AAAA yayımlanmamalı).
- Yedeklerin şifreli dış kopyası ve geri yükleme denemesi.
