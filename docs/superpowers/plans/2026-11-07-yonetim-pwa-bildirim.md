# Yönetim PWA'sı ve anlık bildirimler — uygulama planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Yönetim paneli telefona "Fabrikadann Yönetim" olarak eklenir; site/Trendyol siparişi, iade gerekli ve stok uyarısı anlık bildirim olarak gelir.

**Architecture:** Olaylar kendi veritabanı işlemleri içinde `notifications` kutusuna yazılır (dedupe anahtarıyla). `dispatchPending` kutuyu Web Push (VAPID, `web-push`) ile yalnızca admin aboneliklerine gönderir; site ödemesinden hemen sonra, Trendyol senkronu sonunda ve 5 dakikalık bakımda çağrılır. PWA yalnızca manifest + bildirim gösteren service worker'dır (`/yonetim/` kapsamı, önbellek yok).

**Tech Stack:** Next.js 16 App Router, Drizzle + Postgres, Vitest, `web-push`, sharp.

**Spec:** `docs/superpowers/specs/2026-11-07-yonetim-pwa-bildirim-design.md`

## Global Constraints

- Renk yalnızca tema renkleri; tipografi `.wide`/`.label`/`.tabular`; dokunma hedefleri `min-h-11`; 360px'te yatay kaydırma yok (CLAUDE.md).
- Metinler Türkçe, sade; butonlar ne yaptığını söyler; hatalar nasıl düzeltileceğini söyler.
- Her Server Action: zod + `requireAdmin` + `rateLimit`; kaynak sahipliği (abonelik `user_id` = oturum kullanıcısı).
- Bildirim içeriğinde müşteri adı/adresi/telefonu/e-postası YOK.
- Bildirim `url` değeri `/yonetim/` ile başlamak zorunda; service worker başka adres açmaz.
- İzinli push alan adları: `*.push.apple.com`, `fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`; yalnızca `https:`.
- Kutu kuralları: en fazla 5 deneme; 24 saatten eski gönderilmemiş kayıt gönderilmez (`last_error = 'süresi doldu'`); 30 günden eski kayıt silinir.
- Bildirim gönderimi sipariş/senkron akışını asla bozmaz (hata yutulur, `logError`).
- Stok eşiği `stockAlertThreshold`: tam sayı 0–100, varsayılan 1.
- Yorumlar Türkçe ve seyrek; tanımlayıcılar İngilizce.

## Review Focus

1. Aynı Trendyol siparişi senkronda ikinci kez okunduğunda ya da ilk (baseline) çalıştırmada eski siparişler için bildirim gitmemeli → Task 3 testleri.
2. Bir push servisi yavaş/kapalıyken ödeme dönüşü gecikmemeli; gönderim zaman aşımlı (10 sn) ve hata yutulur → Task 4 testi (sender hata fırlatınca `completePayment` yine `paid` döner).
3. Aynı anda iki `dispatchPending` (bakım + ödeme) aynı bildirimi iki kez göndermemeli → `for update skip locked`; Task 4 testi (eşzamanlı iki çağrı, sender bir kez çağrılır).
4. Yetkisi alınmış (rolü customer yapılmış) eski yöneticinin telefonuna bildirim gitmemeli → Task 4 testi.
5. Kötü niyetli abonelik uç noktası (iç ağ adresi, http) kaydedilmemeli → Task 5 testi.

---

### Task 1: Şema, migration, ortam ve ayar

**Files:**
- Modify: `src/server/db/schema.ts` (yeni `notificationKind` enum, `pushSubscriptions`, `notifications` tabloları)
- Create: `drizzle/0012_bildirimler.sql` (+ meta, `npm run db:generate -- --name bildirimler`)
- Modify: `src/env.ts` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` opsiyonel; üçü birlikte ya da hiçbiri — `superRefine`)
- Modify: `src/server/services/settings.ts` (`stockAlertThreshold: z.number().int().min(0).max(100)`, varsayılan 1; `getSettings(conn: DbOrTx = db)`)
- Test: `tests/services/settings.test.ts`

**Interfaces:**
- Produces: `schema.pushSubscriptions` {id uuid, userId, endpoint unique, p256dh, auth, label, createdAt, lastSuccessAt}; `schema.notifications` {id uuid, kind, source text, title, body, url, dedupeKey unique, data jsonb nullable, createdAt, sentAt, attempts int default 0, lastError}; `notificationKind` = `order_new | refund_needed | stock_low | stock_out | test`; `getSettings(conn?)`.

- [ ] **Step 1:** Test `stockAlertThreshold varsayılanı 1, 101 reddedilir` in `tests/services/settings.test.ts`: `(await getSettings()).stockAlertThreshold === 1`; `updateSettings({ stockAlertThreshold: 101 })` rejects.
- [ ] **Step 2:** Run `npx vitest run tests/services/settings.test.ts` → FAIL.
- [ ] **Step 3:** Implement schema + settings + env; generate migration; `npm run db:migrate`.
- [ ] **Step 4:** Run the test → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit `feat: bildirim tablolari, stok uyari esigi ayari`.

### Task 2: Bildirim kutusu ve stok uyarısı

**Files:**
- Create: `src/server/notifications/outbox.ts`, `src/server/notifications/stock-alert.ts`
- Test: `tests/services/notifications.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, `getSettings(tx)`.
- Produces:
  - `type NotificationInput = { kind; source: "site" | "trendyol" | "n11" | "hepsiburada"; title: string; body: string; url: string; dedupeKey: string; data?: unknown }`
  - `enqueueNotification(tx: DbOrTx, input: NotificationInput): Promise<boolean>` — `on conflict do nothing`; true = yazıldı. `url` `/yonetim/` ile başlamıyorsa hata; title 80, body 200 karaktere kırpılır.
  - `noteStockDrop(tx: Tx, input: { variantId: string; before: number; after: number; reference: string; source: "site" | "trendyol" }): Promise<void>` — kural: `after===0 && before>0` → tükendi; `after>0 && before>T && after<=T` → azaldı; değilse hiçbir şey. Dedupe `stock:{reference}`. Kayıt varsa ve gönderilmemişse `data.lines` ([{variantId, label "Ürün Renk Numara", stock, productId}]) aynı variantId'yi güncelleyerek birleştirilir; `kind` herhangi bir satır 0 ise `stock_out`. Başlık "Stok tükendi" / "Stok azaldı"; gövde `label: stock` satırları " · " ile; url tek ürünse `/yonetim/urunler/{productId}`, değilse `/yonetim/stok`.

- [ ] **Step 1:** Tests: `aynı dedupe anahtarı ikinci kez yazılmaz`; `/yonetim dışı url reddedilir`; `3→1 eşik 1: azaldı`; `1→0: tükendi`; `5→4 eşik 1: bildirim yok`; `eşik 0: yalnızca tükendi`; `aynı referansta iki numara tek bildirim, url /yonetim/stok`.
- [ ] **Step 2:** Run `npx vitest run tests/services/notifications.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: bildirim kutusu ve stok esigi uyarisi`.

### Task 3: Olayları kutuya bağla

**Files:**
- Modify: `src/server/services/payments.ts` (`completePayment` işlemi içinde: `paid` → `order_new` `site:order:{number}`, "Yeni sipariş {number}" / "{adet} ürün · {formatPrice(total)}", url `/yonetim/siparisler/{id}`; `needs_refund`/`amount_mismatch` → `refund_needed` `site:refund:{number}`, "İade gerekli: {number}" / "Ödeme alındı, sipariş karşılanamadı. iyzico panelinden iade edin.")
- Modify: `src/server/services/stock.ts` (`takeStock` `returning` ile yeni stoğu alır; `meta.reason === "order"` ise `noteStockDrop(tx, { before: after+quantity, after, reference: meta.reference ?? variantId, source: "site" })`)
- Modify: `src/server/services/trendyol.ts` (`takeAvailable`: düşüşten sonra `noteStockDrop(..., source: "trendyol")`; `applyOrder`: `existing.length === 0 && !preexisting && wanted.size > 0` ise `order_new` `trendyol:order:{orderNumber}`, "Trendyol siparişi {orderNumber}" / "{toplam adet} ürün" + kısa ise " · {n} adet için sitede stok yoktu", url `/yonetim/stok`)
- Test: `tests/services/store-notification.test.ts`, `tests/services/trendyol.test.ts`

**Interfaces:** Consumes Task 2 `enqueueNotification`, `noteStockDrop`.

- [ ] **Step 1:** Tests: `ödenen sipariş order_new yazar, müşteri adı gövdede yok`; `iade gereken ödeme refund_needed yazar`; `aynı ödeme ikinci kez işlenince ikinci kayıt yok`; `sipariş son stoğu bitirince stock_out`; Trendyol: `yeni sipariş order_new yazar`, `ilk (baseline) çalıştırmadaki eski sipariş yazmaz`, `aynı paket ikinci okumada yazmaz`, `Trendyol satışı stoğu bitirince stock_out (source trendyol)`.
- [ ] **Step 2:** Run both files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run full `npm test` → PASS (mevcut testler bozulmamalı).
- [ ] **Step 5:** Commit `feat: siparis, iade ve stok olaylari bildirim kutusuna yaziliyor`.

### Task 4: Gönderim (Web Push)

**Files:**
- Create: `src/server/notifications/push.ts`, `src/server/notifications/dispatch.ts`
- Modify: `package.json` (`web-push`, `@types/web-push`)
- Modify: `src/server/services/payments.ts` (e-postalardan sonra `dispatchPending().catch(logError)`), `scripts/trendyol-sync.ts` ve `scripts/maintenance.ts` (sonda `dispatchPending`; bakım `pruneNotifications` da)
- Test: `tests/services/notification-dispatch.test.ts`

**Interfaces:**
- Produces:
  - `type PushPayload = { title: string; body: string; url: string; tag: string }`
  - `type PushResult = "ok" | "gone" | "error"`
  - `interface PushSender { send(sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload): Promise<PushResult> }`
  - `webPushSender(): PushSender | null` — VAPID yoksa null; `web-push` `sendNotification` TTL 86400, urgency `high`, timeout 10000; 404/410 → `gone`.
  - `dispatchPending(opts?: { sender?: PushSender | null; now?: Date }): Promise<{ sent: number; failed: number; expired: number }>` — varsayılan sender `webPushSender()`; null ise hiçbir şey yapmaz. Bir işlemde `for update skip locked` ile en fazla 50 kayıt; alıcılar `users.role = 'admin'` olan aboneler (`kind = 'test'` ise yalnızca `data.userId` kullanıcısının abonelikleri); rolü admin olmayanların abonelikleri silinir; en az bir `ok` → `sentAt`; hiç abone yoksa `sentAt` (gönderilecek kimse yok) ve `lastError = 'abone yok'`; tümü hata → `attempts+1`, `lastError`.
  - `pruneNotifications(now?: Date): Promise<number>` — 30 günden eski kayıtları siler.

- [ ] **Step 1:** Tests (sahte sender): `yalnızca admin abonelerine gider`; `rolü customer yapılan kullanıcının aboneliği silinir ve ona gönderilmez`; `gone dönen abonelik silinir`; `hata attempts artırır, 5. denemeden sonra gönderilmez`; `24 saatten eski gönderilmez, süresi doldu yazılır`; `eşzamanlı iki dispatchPending aynı bildirimi bir kez gönderir`; `sender null ise kayıtlar beklemede kalır`; `sender hata fırlatınca completePayment yine paid döner`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `npm i web-push && npm i -D @types/web-push`; implement.
- [ ] **Step 4:** Run full `npm test` → PASS; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat: bildirimler Web Push ile yoneticilere gonderiliyor`.

### Task 5: Abonelik servisi ve action'lar

**Files:**
- Create: `src/server/services/admin/notifications.ts`, `src/app/yonetim/(panel)/ayarlar/bildirimler/actions.ts`
- Modify: `src/app/yonetim/(panel)/actions.ts` (`adminSignOutAction` gizli `endpoint` alanını okuyup kullanıcıya aitse siler)
- Test: `tests/yonetim/notifications.test.ts`

**Interfaces:**
- Produces (servis):
  - `subscriptionInput` zod: `{ endpoint: string (url, ≤ 1000, https, izinli alan adı), keys: { p256dh: string (base64url, ≤ 200), auth: string (base64url, ≤ 100) } }`
  - `saveSubscription(userId: string, input, userAgent: string | null): Promise<void>` — endpoint varsa sahibini ve anahtarları günceller (başka kullanıcıdaysa bu kullanıcıya geçer); `label` UA'dan: "iPhone"/"iPad"/"Android"/"Mac"/"Windows" + " · " + "Safari"/"Chrome"/"Firefox"/"Edge" (bilinmiyorsa "Tarayıcı").
  - `removeSubscription(userId: string, idOrEndpoint: { id?: string; endpoint?: string }): Promise<boolean>` — yalnızca kullanıcının kendi kaydı.
  - `listSubscriptions(userId: string)` → `{ id, label, createdAt, lastSuccessAt }[]`
  - `sendTestNotification(userId: string, now?: Date)` — `kind: "test"`, dedupe `test:{userId}:{yyyyMMddHHmm}`, "Deneme bildirimi" / "Bildirimler bu cihazda çalışıyor.", url `/yonetim/ayarlar/bildirimler`; `data: { userId }` yazar; süzme Task 4'teki `dispatchPending` kuralıyla olur.
- Produces (action'lar, hepsi `requireAdmin` + `rateLimit` 30/saat kullanıcı başına): `subscribeAction(json: unknown): Promise<{ ok: true } | { error: string }>`, `unsubscribeAction(endpoint: string)`, `removeDeviceAction(prev: FormState, formData: FormData)`, `sendTestAction(prev: FormState, formData: FormData)`.

- [ ] **Step 1:** Tests: `http uç nokta reddedilir`; `izinli olmayan alan adı (ör. https://169.254.169.254/x, https://example.com) reddedilir`; `apple ve fcm kabul edilir, etiket iPhone · Safari`; `başka kullanıcının aboneliği silinemez`; `deneme bildirimi yalnızca kendi cihazına gider`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: yonetici cihaz bildirim aboneligi`.

### Task 6: PWA ve Bildirimler sayfası

**Files:**
- Create: `scripts/make-pwa-icons.ts` (sharp; `src/app/icon.svg` ya da `@/components/brand/Logo` SVG'sinden siyah zemin üzerinde beyaz logo; çıktılar `public/yonetim/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (%20 kenar boşluğu), `apple-touch-icon.png` 180, `badge-96.png` saydam zemin beyaz) — çıktılar depoya eklenir.
- Create: `src/app/yonetim/manifest.webmanifest/route.ts` (spec'teki alanlar; `Content-Type: application/manifest+json`)
- Create: `src/app/yonetim/sw.js/route.ts` (`push` + `notificationclick`; `Content-Type: application/javascript; charset=utf-8`, `Cache-Control: no-cache`)
- Modify: `src/app/yonetim/layout.tsx` (metadata: `manifest: "/yonetim/manifest.webmanifest"`, `appleWebApp: { capable: true, title: "Fabrikadann", statusBarStyle: "black" }`, `icons.apple`)
- Create: `src/components/admin/PushRegistration.tsx` (panel düzeninde SW kaydı), `src/components/admin/PushToggle.tsx` (aç/kapat, iPhone talimatı, izin reddedildi metni), `src/components/admin/SignOutEndpoint.tsx` (çıkış formuna gizli `endpoint`)
- Create: `src/app/yonetim/(panel)/ayarlar/bildirimler/page.tsx` (`requireAdmin`; VAPID genel anahtarını prop olarak verir; cihaz listesi + Kaldır + Deneme bildirimi; VAPID yoksa "Bildirim anahtarları sunucuda tanımlı değil.")
- Modify: `src/app/yonetim/(panel)/ayarlar/page.tsx` + `actions.ts` (stok uyarı eşiği alanı; Bildirimler sayfasına bağlantı), `src/app/yonetim/(panel)/layout.tsx` (PushRegistration, SignOutEndpoint)

Service worker davranışı (spec'in sabitlediği):

```js
self.addEventListener("push", (e) => {
  const d = e.data ? e.data.json() : {};
  const url = typeof d.url === "string" && d.url.startsWith("/yonetim") ? d.url : "/yonetim";
  e.waitUntil(self.registration.showNotification(d.title || "Fabrikadann", {
    body: d.body || "", tag: d.tag, data: { url },
    icon: "/yonetim/icon-192.png", badge: "/yonetim/badge-96.png",
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/yonetim", self.location.origin).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname.startsWith("/yonetim"));
    return open ? open.focus().then(() => open.navigate(url)) : clients.openWindow(url);
  }));
});
```

Not: `public/yonetim/*` statik dosyaları proxy eşleyicisinden geçer (CSP başlığı, zararsız). Eşleyiciye dokunulmaz.

- [ ] **Step 1:** `npx tsx scripts/make-pwa-icons.ts`; PNG'lerin boyutlarını `sharp(...).metadata()` ile doğrula (192/512/512/180/96).
- [ ] **Step 2:** Implement route'lar, bileşenler, sayfa.
- [ ] **Step 3:** `npx tsc --noEmit` temiz; `npm run build` başarılı; `next start -p 3100` ile `curl -sI localhost:3100/yonetim/manifest.webmanifest` → 200 `application/manifest+json`, `curl -s localhost:3100/yonetim/sw.js | head -1` → JS; vitrin ana sayfasının HTML'inde `manifest` bağlantısı YOK (`curl -s localhost:3100/ | grep -c webmanifest` → 0); `/yonetim/giris` HTML'inde VAR.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: Fabrikadann Yonetim PWA'si ve Bildirimler sayfasi`.

### Task 7: Trendyol stok karşılaştırma betiği

**Files:**
- Create: `scripts/trendyol-stock-compare.ts` (salt okuma: tüm onaylı içeriklerin varyantları → barkod, Trendyol adedi; site `variants.barcode` ile eşleştirip yalnızca farklı olanları ve sitede olmayanları tablo olarak yazar; sonda özet: eşleşen, farklı, sitede yok, Trendyol'da yok)
- Modify: `package.json` (`"trendyol:compare": "tsx scripts/trendyol-stock-compare.ts"`)

- [ ] **Step 1:** `npx tsc --noEmit` temiz.
- [ ] **Step 2:** Commit `feat: Trendyol ve site stoklarini karsilastiran salt okuma betigi`.

### Task 8: Belgeler ve canlıya alma

**Files:**
- Modify: `docs/CANLIYA-ALMA.md` (VAPID anahtarı üretimi, migration 0012, Bildirimler sayfası ve iPhone'da kurulum, `trendyol:compare` ve senkron cron satırı `*/2 * * * *`)
- Modify: `CLAUDE.md` (`src/server/notifications/*` mimari satırı)

- [ ] **Step 1:** Belgeleri güncelle; commit `docs: bildirimler ve Trendyol senkronu canliya alma adimlari`.
- [ ] **Step 2:** Canlı: DB yedeği → imaj → VAPID anahtarlarını `.env.production`'a ekle → migration 0012 → `up -d app` → site 200, `/yonetim/manifest.webmanifest` 200.
- [ ] **Step 3:** Canlıda `npm run trendyol:compare` → farklar kullanıcıya gösterilir; onaydan sonra cron'a senkron satırı eklenir.
- [ ] **Step 4:** Kullanıcıyla cihaz denemesi: iPhone (ana ekrandan) + Android, "Deneme bildirimi gönder".
