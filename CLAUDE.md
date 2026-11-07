# fabrikadann.com

Ayakkabı e-ticaret sitesi. Spec: `docs/superpowers/specs/2026-10-25-magaza-v1-design.md`, plan: `docs/superpowers/plans/2026-10-25-magaza-v1.md`.

@AGENTS.md

## Komutlar

- `npm run db:up` — Postgres (Docker, 127.0.0.1:5433; `.env`deki `DB_PORT` ile değişir — bu makinede 5434, çünkü 5433 başka projede). `npm run db:migrate`, `npm run db:seed` (örnek ürünler, yalnızca geliştirme)
- `npm run dev` — http://localhost:3000
- `npm test` — Vitest, gerçek Postgres test veritabanı (`TEST_DATABASE_URL`). Testler veritabanını TRUNCATE eder; farklı süreçler aynı anda aynı test veritabanını kullanmamalı.
- `npx tsc --noEmit` — tip kontrolü
- Şema değişikliği: `src/server/db/schema.ts` → `npm run db:generate -- --name <ad>` → `npm run db:migrate`

## Mimari

- `src/server/services/*` — iş mantığı; UI'dan bağımsız (ileride mobil uygulama API'si bunu kullanacak). Sayfalar ve Server Action'lar doğrudan veritabanına değil servislere gider.
- `src/server/auth/*` — oturum (`current.ts`: `getCurrentUser`, `requireUser`, `requireAdmin`, `getClientIp`), parola, hız sınırı, TOTP.
- `src/server/cart-owner.ts` — sepet sahibi (kullanıcı ya da misafir çerezi).
- `src/server/services/admin/{manufacturers,purchases,ledger,accounting}.ts` — üretici, alış/iade fişi, gelir-gider, cari ve dönem özeti. Alış fiyatı ve üretici `product_supply`, satıştaki maliyet `order_item_costs` tablosunda; vitrin sorguları bunlara dokunmaz. Üretim barkodu (`variants.production_barcode`, EAN-13, `29…`) veritabanı fonksiyonuyla üretilir.
- `src/server/notifications/*` — yönetici bildirimleri: olaylar `enqueueNotification` ile kendi işlemleri içinde `notifications` kutusuna yazılır (dedupe anahtarı), `dispatchPending` Web Push (VAPID) ile admin aboneliklerine gönderir. Yeni kaynak (N11, Hepsiburada) aynı kutuya `source` ile yazar. PWA: `/yonetim/manifest.webmanifest`, `/yonetim/sw.js` (yalnızca `/yonetim/` kapsamı, önbellek yok).
- `src/server/marketplaces/n11/*` + `src/server/services/marketplace-sync.ts` + `src/server/services/admin/n11.ts` — N11 (site → N11): istemci, SKU oluşturucu, kategori eşleştirme, gönderim, senkron (`npm run marketplace:sync`). Kanal bazlı `marketplace_*` tabloları (Hepsiburada aynılarını kullanacak); Trendyol'un kendi tabloları ayrı. API özeti `docs/n11-api-ozet.md`.
- `src/server/ai/product-assistant.ts` + `services/admin/ai-assistant.ts` — AI Asistan (Claude API, `claude-opus-5-5`, yapılandırılmış çıktı): ürün fotoğraflarından ad, açıklama, malzeme-bakım, kategori, renk adı, N11 özelliği önerir; hiçbir şeyi kendiliğinden kaydetmez. Ürüne özel pazaryeri özellikleri `products.marketplace_attrs`.
- `src/server/payments` — ödeme sağlayıcı arayüzü; şu an yalnızca test ödemesi (`mock`). iyzico adaptörü sonra eklenecek.
- `src/server/storage/images.ts` — ürün görselleri (sharp ile yeniden kodlanır, `/medya/...` route'undan sunulur).
- `src/app/(magaza)` vitrin, `src/app/yonetim` yönetim paneli.
- Next.js 16: `params`/`searchParams`/`cookies()`/`headers()` Promise döner; middleware yerine `src/proxy.ts`.

## Kurallar

- **Renk:** yalnızca Tailwind tema renkleri `ink` (#000), `paper` (#fff), `graphite`, `ash`, `rule`, `fog`, `night`. Başka renk yok — hata durumları dahil (hata: siyah metin + `ErrorMark` simgesi + kalın alt çizgi). İstisnalar: `public/brand/iyzico/` altındaki resmî iyzico/kart logoları (ödeme kuruluşu şartı; renkleri değiştirilmez) ve yönetim panelinde "sitede eksik" satırları için `caution` rengi, yalnızca `bg-caution/5` hafif arka plan olarak (kullanıcı isteği, 07.11.2026; vitrinde kullanılmaz).
- **Tipografi:** Archivo. Başlık/etiket: `.wide` (geniş, aralıklı büyük harf) ya da `.label` (küçük büyük harf). Fiyatlar `.tabular`. Metin cümle düzeninde.
- **Bileşenler:** `@/components/ui/form` (Button, ButtonLink, TextField, SelectField, TextArea, Checkbox, FormNotice), `ProductImage`, `Price`, `AddressFields`, `@/components/brand/Logo`.
- **Dokunma hedefleri:** tıklanabilir her şey en az 44px yüksek (`min-h-11`). 360px genişlikte yatay kaydırma olmamalı.
- **Metin:** Türkçe, sade, eyleme dönük. Butonlar ne yaptığını söyler ("Sepete ekle", "Siparişi tamamla"). Hatalar ne olduğunu ve nasıl düzeltileceğini söyler, özür dilemez.
- **URL'ler:** Türkçe ve ASCII (`/urun/[slug]`, `/sepet`, `/odeme`, `/hesabim`).
- **Para:** kuruş cinsinden tam sayı; gösterim `formatPrice`. Fiyat/toplam yalnızca sunucuda hesaplanır, istemciden asla alınmaz.
- **Güvenlik:** her Server Action girdisi zod ile doğrulanır; korumalı her işlem sunucuda `requireUser`/`requireAdmin` ile başlar ve kaynak sahipliğini kontrol eder (yalnızca proxy'e güvenilmez). Kimlik doğrulama işlemleri `rateLimit` ile sınırlanır. Kullanıcı HTML'i render edilmez. Yönlendirme hedefleri `safeReturnPath` ile süzülür.
- **Formlar:** Server Action + `useActionState`, durum tipi `FormState` (`@/lib/form`). Parola alanları hata sonrası geri doldurulmaz.
- Yorumlar Türkçe ve seyrek; tanımlayıcılar İngilizce.
