# fabrikadann.com

fabrikadann'ın ayakkabı mağazası. Siyah-beyaz, Zara çizgisinde bir vitrin; sepet, misafir/üye ödeme,
sipariş takibi, müşteri hesabı ve iki adımlı doğrulamalı yönetim paneli.

- Tasarım ve kararlar: [`docs/superpowers/specs/2026-10-25-magaza-v1-design.md`](docs/superpowers/specs/2026-10-25-magaza-v1-design.md)
- Canlıya alma ve işletme: [`docs/CANLIYA-ALMA.md`](docs/CANLIYA-ALMA.md)
- Güvenlik denetimi raporu: [`docs/guvenlik-denetimi-2026-10-26.md`](docs/guvenlik-denetimi-2026-10-26.md)
- Geliştirici kuralları: [`CLAUDE.md`](CLAUDE.md)

## Yerelde çalıştırma

Gerekenler: Node.js 22+ (24 önerilir), Docker Desktop.

```bash
npm install
cp .env.example .env          # SESSION_SECRET'ı doldurun (dosyadaki komutla üretin)
npm run db:up                 # Postgres (127.0.0.1:5433)
npm run db:migrate
npm run db:seed               # 8 örnek ürün, 5 kategori ("ÖRNEK GÖRSEL" yazan gri görseller)
npm run dev                   # http://localhost:3000
```

Yönetici hesabı (parola ve iki adımlı doğrulama anahtarı bir kez ekrana yazılır):

```bash
npm run admin:create -- siz@ornek.com Ad Soyad
```

Panel: http://localhost:3000/yonetim — parola, ardından doğrulama uygulamasındaki 6 haneli kod.

Geliştirmede ödeme "test ödemesi"dir: ödeme adımında sitedeki test sayfası açılır, "Ödeme başarılı" ya
da "Ödeme başarısız" seçilir. E-postalar (sipariş onayı, parola sıfırlama) terminale yazılır.

## Testler

```bash
npm test             # birim + servis testleri (gerçek Postgres test veritabanı)
npx tsc --noEmit     # tip kontrolü
npm run e2e          # Playwright: telefon (Pixel 7) ve masaüstünde taşma, dokunma hedefi (44px),
                     # misafir satın alma, yönetim koruması — sistemdeki Chrome'u kullanır
```

## Yapı

| Yol | İçerik |
|---|---|
| `src/app/(magaza)` | Vitrin: ana sayfa, listeleme, arama, ürün, sepet, ödeme, sipariş, hesap, yasal sayfalar |
| `src/app/yonetim` | Yönetim paneli (pano, siparişler, ürünler, kategoriler, stok, müşteriler, ayarlar, işlem günlüğü) |
| `src/server/services` | İş mantığı — UI'dan bağımsız; mobil uygulama API'si bunun üstüne kurulacak |
| `src/server/auth` | Oturum, parola (argon2id), hız sınırı, TOTP |
| `src/server/payments` | Ödeme sağlayıcı arayüzü: test ödemesi + iyzico Checkout Form adaptörü |
| `src/server/storage` | Ürün görselleri (sharp ile yeniden kodlanır, `/medya` üzerinden sunulur) |
| `src/proxy.ts` | Her istekte nonce'lu CSP |
| `deploy/` | Canlı için Docker Compose + Caddy (otomatik HTTPS) |
| `scripts/` | migration, örnek veri, yönetici oluşturma, zamanlanmış bakım, logo vektörleştirme |

## Durum

Hazır: vitrin, sepet, ödeme akışı (test ödemesiyle uçtan uca), sipariş ve stok yönetimi, müşteri hesabı,
yönetim paneli, güvenlik sertleştirmesi ve denetimi, canlıya alma dosyaları.

Gerçek satıştan önce: iyzico anlaşması ve sandbox ile uçtan uca deneme, yasal metinlerin avukat
kontrolü, şirket bilgilerinin panelden girilmesi, gerçek ürün fotoğrafları, SMTP. Ayrıntılı liste:
[`docs/CANLIYA-ALMA.md`](docs/CANLIYA-ALMA.md) §8.

Sonraki adımlar: Trendyol stok senkronu (stok hareketleri `source` ile kaydediliyor; ortak stok için
altyapı hazır), mobil uygulama API'si, e-fatura.
