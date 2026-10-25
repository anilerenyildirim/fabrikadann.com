# fabrikadann.com — Mağaza v1 Tasarımı

Tarih: 2026-10-25 · Durum: uygulamaya alındı (kullanıcı kararları devretti)

## 1. Amaç ve bağlam

fabrikadann bir dijital ayakkabı mağazası. Mobil uygulama çıkmadan önce fabrikadann.com
**gerçek bir mağaza** olacak: ürün, sepet, ödeme, sipariş, stok.

Kullanıcının söyledikleri:
- Trafik Instagram'dan siteye yönlendirilecek; Trendyol'da da satılacak ama **sitede indirimli**.
- Stok Trendyol ile **ortak** olacak.
- Ödeme **iyzico** ile; anlaşma site bitince yapılacak, entegrasyon sonra eklenecek.
- Tasarım **Zara örnek alınarak**, yalnızca **siyah-beyaz** (+ gerekirse gri tonları). Turuncu yok.
- Mağazayı kullanıcı kendisi yönetecek (teknik bilgisi var), ama **yönetim paneli** şart.
- Henüz ürün/stok yok; model sayısı belli değil.
- Çalışma sonunda **beyaz şapkalı güvenlik denetimi** yapılacak, bulunan açıklar kapatılacak.
- Shopify kullanılmayacak; özel geliştirme.

Varsayımlar (kullanıcı düzeltebilir):
- Hedef pazar Türkiye, para birimi TL, fiyatlar KDV dahil.
- Barındırma henüz seçilmedi → proje Docker ile her yere taşınabilir olacak.
- Uygulama geldiğinde aynı veritabanı ve iş mantığı kullanılacak → iş mantığı UI'dan ayrı
  servis katmanında durur, ileride REST/JSON API bu katmanın üstüne ince bir kabuk olarak eklenir.

Başarı ölçütü: Instagram'dan gelen biri, telefonundan ürünü bulup birkaç dokunuşla güvenle
satın alabilmeli; site Zara kalitesinde, sade ve hızlı hissettirmeli; kullanıcı panelden ürün
ekleyip siparişleri yönetebilmeli; bilinen bir güvenlik açığı kalmamalı.

## 2. Mimari

Tek bir Next.js uygulaması (App Router, TypeScript), PostgreSQL veritabanı.

| Katman | Seçim | Neden |
|---|---|---|
| Web | Next.js 16 + React 19, Server Components + Server Actions | SSR (SEO, hız), tek dağıtım birimi |
| Stil | Tailwind CSS 4 + birkaç CSS değişkeni | Siyah-beyaz tasarım sistemi, hızlı geliştirme |
| Veri | PostgreSQL 17 + Drizzle ORM + drizzle-kit migration | Tip güvenli SQL, motor/codegen yok |
| Doğrulama | zod | Her sunucu girişinde şema doğrulaması |
| Parola | argon2id (@node-rs/argon2) | Güncel öneri |
| Görsel | sharp | Yeniden kodlama (EXIF temizler, zararlı dosyayı eler), WebP + boyutlar |
| Test | Vitest (gerçek Postgres test veritabanıyla) + Playwright smoke | İş mantığı ve ana akış |

Klasörler:

```
src/
  app/(magaza)/...      vitrin sayfaları
  app/yonetim/...       yönetim paneli
  app/api/...           yalnızca dış çağrılar (ödeme callback, görsel servis)
  server/db/            şema, bağlantı
  server/services/      iş mantığı (katalog, sepet, sipariş, stok, auth, ödeme…) — UI'dan bağımsız
  server/payments/      PaymentProvider arayüzü + mock (ileride iyzico)
  server/storage/       görsel depolama arayüzü (yerel disk; ileride S3/R2)
  server/mail/          e-posta arayüzü (geliştirmede konsol; ileride SMTP)
  components/           UI bileşenleri
  lib/                  para, slug, format yardımcıları
```

Dış servisler arayüz arkasında: **ödeme** (`PaymentProvider`), **depolama**, **e-posta**,
**Trendyol stok senkronu** (v1'de yalnızca stok hareketleri `source` alanıyla kaydedilir;
entegrasyon Trendyol satıcı hesabı açılınca yazılır). Böylece iyzico geldiğinde yalnızca bir
adaptör eklenir.

## 3. Veri modeli (özet)

- `users` (e-posta, parola özeti, ad, telefon, rol: `customer|admin`, TOTP sırrı — yalnız admin)
- `sessions` (token **özeti**, kullanıcı, son kullanma)
- `addresses` (kullanıcıya ait; il, ilçe, açık adres, telefon)
- `categories` (ad, slug, sıra)
- `products` (ad, slug, açıklama, kategori, fiyat (kuruş), trendyol fiyatı (kuruş, opsiyonel),
  durum `draft|active|archived`, malzeme/bakım bilgisi)
- `product_colors` (ürün, renk adı, sıra) → `product_images` (renk, dosya anahtarı, sıra, alt metin)
- `variants` (renk + numara, SKU, barkod, **stok**, ayrılmış stok değil — rezervasyon siparişte)
- `stock_movements` (varyant, fark, sebep `order|cancel|manual|trendyol`, referans, zaman) — denetim izi
- `carts` + `cart_items` (misafir: imzalı çerez kimliği; üye: kullanıcıya bağlı; girişte birleşir)
- `orders` (numara, kullanıcı/misafir e-posta, adres anlık kopyası, tutarlar, durum, ödeme durumu,
  kargo firması + takip no, sözleşme onay zamanı/IP) + `order_items` (ürün anlık kopyası: ad,
  renk, numara, birim fiyat)
- `payments` (sipariş, sağlayıcı, sağlayıcı referansı, durum, tutar, ham yanıt)
- `password_reset_tokens` (özet, son kullanma, kullanıldı mı)
- `rate_limits` (anahtar, pencere, sayaç)
- `audit_log` (admin işlemleri: kim, ne, ne zaman)
- `settings` (kargo ücreti, ücretsiz kargo eşiği, iletişim bilgileri, şirket unvanı vb.)

Para her yerde **kuruş cinsinden tam sayı**. Fiyat hesabı **yalnızca sunucuda**.

## 4. Vitrin (Zara tarzı)

Tasarım ilkeleri: beyaz zemin, siyah metin, gri yalnız ikincil bilgi ve çizgi; ince, küçük,
büyük harf aralıklı tipografi; fotoğraf tam genişlik; kenarlık ve gölge yok; animasyon sade.
Mobil öncelikli (Instagram trafiği).

Sayfalar:
- **Ana sayfa**: tam ekran vitrin görselleri (panelden seçilen ürünler/kategoriler), az metin.
- **Kategori / tümü**: ürün ızgarası (mobilde 2, masaüstünde 4 sütun; Zara gibi 2↔4 değiştirici),
  numara ve fiyat filtresi, sıralama.
- **Arama**.
- **Ürün detayı**: dikey görsel galerisi, renk seçimi, numara seçimi (stoksuz numara pasif),
  "Sepete ekle", fiyat; Trendyol fiyatı girilmişse "Trendyol'da X TL — sitede Y TL" bilgisi,
  malzeme/bakım, kargo-iade özeti.
- **Sepet** (yan çekmece + sayfa), **Ödeme** (misafir veya üye → adres → özet + yasal onaylar →
  ödeme), **Sipariş onayı**.
- **Hesabım**: siparişler (durum + kargo takip), adresler, profil/parola. Giriş, kayıt, parola sıfırlama.
- **Yasal/kurumsal**: KVKK aydınlatma metni, çerez politikası, mesafeli satış sözleşmesi, ön
  bilgilendirme formu, iade ve değişim, iletişim, SSS. Şirket bilgileri `settings`ten gelir;
  metinler **taslak**tır, hukukçu kontrolü gerekir.

Not (yasal): "İndirim" ibaresi Haksız Ticari Uygulamalar Yönetmeliği'ne tabidir. Bu yüzden
Trendyol karşılaştırması "indirim %" değil, iki kanalın fiyatını gösteren bilgi olarak sunulur.

## 5. Yönetim paneli (`/yonetim`)

- Yalnızca `admin` rolü; parola + **TOTP iki adımlı doğrulama** zorunlu.
- Pano: bekleyen siparişler, bugünkü ciro, düşük stok.
- Ürünler: listele/ara, oluştur/düzenle, renkler + görseller (yükle, sırala, sil), numara/SKU/stok
  ızgarası, yayın durumu.
- Kategoriler.
- Siparişler: liste + filtre, detay, durum geçişleri (`odeme_bekleniyor → hazirlaniyor → kargoda →
  teslim_edildi`, `iptal`, `iade`), kargo takip no; iptal/iade stok iadesi yapar.
- Stok: varyant bazında elle düzeltme (sebep zorunlu, `stock_movements`'a yazılır).
- Müşteriler (salt okunur), Ayarlar (kargo, şirket bilgileri), işlem günlüğü.

## 6. Kritik akışlar

**Stok ve sipariş:** Ödeme adımına geçilince sipariş `odeme_bekleniyor` durumunda oluşturulur ve
stok tek SQL ifadesiyle koşullu düşülür (`UPDATE … SET stock = stock - n WHERE stock >= n`) —
aşırı satış yarış koşulu yoktur. Ödeme başarısız olursa ya da 30 dk içinde tamamlanmazsa stok
iade edilir (süresi geçenler her sipariş oluşturmada ve panel açılışında temizlenir; prod'da
ayrıca zamanlanmış görev). Ödeme başarılıysa `hazirlaniyor`.

**Ödeme:** `PaymentProvider { start(order) → yönlendirme; verify(callback) → sonuç }`.
v1'de `MockPaymentProvider` (yalnız geliştirme; prod'da kapalı). iyzico Checkout Form adaptörü
anlaşma sonrası eklenir; callback'te tutar ve sipariş eşleşmesi sunucuda doğrulanır.

## 7. Güvenlik tasarımı

- Oturum: rastgele 256-bit token, veritabanında SHA-256 özeti; çerez `HttpOnly; Secure;
  SameSite=Lax`; girişte yeni oturum (session fixation yok); çıkışta silme.
- Parola: argon2id, en az 10 karakter; sızdırılmış/çok yaygın parola listesi kontrolü.
- Hesap numaralandırma yok: giriş/sıfırlama yanıtları aynı.
- Hız sınırlama: giriş, kayıt, sıfırlama, TOTP, ödeme başlatma (IP + hesap anahtarı).
- CSRF: Server Action'ların origin kontrolü + route handler'larda Origin doğrulaması.
- Yetkilendirme: her admin işlemi ve her müşteri kaynağı (sipariş, adres) sunucuda sahiplik
  kontrolüyle (IDOR yok); yalnızca middleware'e güvenilmez.
- Girdi: tüm girişler zod ile; sorgular parametreli (Drizzle); kullanıcı HTML'i render edilmez.
- Başlıklar: nonce'lu CSP, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors 'none',
  Permissions-Policy.
- Yükleme: tür/boyut sınırı, sharp ile yeniden kodlama, rastgele dosya adı, yalnızca admin.
- Fiyat/tutar istemciden asla alınmaz.
- Gizli bilgiler yalnız ortam değişkenlerinde; `.env` git'e girmez.
- Denetim günlüğü: admin işlemleri.
- **Son aşama:** OWASP Top 10 + iş mantığı (fiyat manipülasyonu, stok yarışı, IDOR, ödeme
  callback sahteciliği) odaklı tam denetim; bulunanlar kapatılır ve raporlanır.

## 8. Hata yönetimi

Kullanıcıya Türkçe, sade hata mesajları; iç hata ayrıntısı gösterilmez, sunucuda loglanır.
Form hataları alan bazında. 404/500 sayfaları tasarıma uygun.

## 9. Test

- Vitest: para hesapları, sepet toplamı, stok rezervasyonu ve eşzamanlılık, sipariş durum
  geçişleri, auth (parola, oturum, hız sınırı), yetkilendirme kontrolleri — gerçek Postgres ile.
- Playwright smoke: ürün → sepet → ödeme (mock) → sipariş görüldü; admin giriş.

## 10. Kapsam dışı (v1)

iyzico canlı entegrasyonu, Trendyol API senkronu, e-fatura, kupon/kampanya motoru, çoklu dil,
analitik/pazarlama pikselleri, mobil uygulama API'si, canlı dağıtım. Hepsi için yer ayrıldı.
