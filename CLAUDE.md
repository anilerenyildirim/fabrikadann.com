# fabrikadann.com

Ayakkabı e-ticaret sitesi. Spec: `docs/superpowers/specs/2026-10-25-magaza-v1-design.md`, plan: `docs/superpowers/plans/2026-10-25-magaza-v1.md`.

@AGENTS.md

## Komutlar

- `npm run db:up` — Postgres (Docker, 127.0.0.1:5433). `npm run db:migrate`, `npm run db:seed` (örnek ürünler, yalnızca geliştirme)
- `npm run dev` — http://localhost:3000
- `npm test` — Vitest, gerçek Postgres test veritabanı (`TEST_DATABASE_URL`). Testler veritabanını TRUNCATE eder; farklı süreçler aynı anda aynı test veritabanını kullanmamalı.
- `npx tsc --noEmit` — tip kontrolü
- Şema değişikliği: `src/server/db/schema.ts` → `npm run db:generate -- --name <ad>` → `npm run db:migrate`

## Mimari

- `src/server/services/*` — iş mantığı; UI'dan bağımsız (ileride mobil uygulama API'si bunu kullanacak). Sayfalar ve Server Action'lar doğrudan veritabanına değil servislere gider.
- `src/server/auth/*` — oturum (`current.ts`: `getCurrentUser`, `requireUser`, `requireAdmin`, `getClientIp`), parola, hız sınırı, TOTP.
- `src/server/cart-owner.ts` — sepet sahibi (kullanıcı ya da misafir çerezi).
- `src/server/payments` — ödeme sağlayıcı arayüzü; şu an yalnızca test ödemesi (`mock`). iyzico adaptörü sonra eklenecek.
- `src/server/storage/images.ts` — ürün görselleri (sharp ile yeniden kodlanır, `/medya/...` route'undan sunulur).
- `src/app/(magaza)` vitrin, `src/app/yonetim` yönetim paneli.
- Next.js 16: `params`/`searchParams`/`cookies()`/`headers()` Promise döner; middleware yerine `src/proxy.ts`.

## Kurallar

- **Renk:** yalnızca Tailwind tema renkleri `ink` (#000), `paper` (#fff), `graphite`, `ash`, `rule`, `fog`, `night`. Başka renk yok — hata durumları dahil (hata: siyah metin + `ErrorMark` simgesi + kalın alt çizgi).
- **Tipografi:** Archivo. Başlık/etiket: `.wide` (geniş, aralıklı büyük harf) ya da `.label` (küçük büyük harf). Fiyatlar `.tabular`. Metin cümle düzeninde.
- **Bileşenler:** `@/components/ui/form` (Button, ButtonLink, TextField, SelectField, TextArea, Checkbox, FormNotice), `ProductImage`, `Price`, `AddressFields`, `@/components/brand/Logo`.
- **Dokunma hedefleri:** tıklanabilir her şey en az 44px yüksek (`min-h-11`). 360px genişlikte yatay kaydırma olmamalı.
- **Metin:** Türkçe, sade, eyleme dönük. Butonlar ne yaptığını söyler ("Sepete ekle", "Siparişi tamamla"). Hatalar ne olduğunu ve nasıl düzeltileceğini söyler, özür dilemez.
- **URL'ler:** Türkçe ve ASCII (`/urun/[slug]`, `/sepet`, `/odeme`, `/hesabim`).
- **Para:** kuruş cinsinden tam sayı; gösterim `formatPrice`. Fiyat/toplam yalnızca sunucuda hesaplanır, istemciden asla alınmaz.
- **Güvenlik:** her Server Action girdisi zod ile doğrulanır; korumalı her işlem sunucuda `requireUser`/`requireAdmin` ile başlar ve kaynak sahipliğini kontrol eder (yalnızca proxy'e güvenilmez). Kimlik doğrulama işlemleri `rateLimit` ile sınırlanır. Kullanıcı HTML'i render edilmez. Yönlendirme hedefleri `safeReturnPath` ile süzülür.
- **Formlar:** Server Action + `useActionState`, durum tipi `FormState` (`@/lib/form`). Parola alanları hata sonrası geri doldurulmaz.
- Yorumlar Türkçe ve seyrek; tanımlayıcılar İngilizce.
