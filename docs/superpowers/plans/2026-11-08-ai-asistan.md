# AI Asistan — uygulama planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fotoğraflardan ürün adı, açıklama, malzeme-bakım, kategori, renk adı ve N11 özelliği önerisi; yönetici seçip uygular.

**Architecture:** `src/server/ai/product-assistant.ts` (istem kurma + doğrulama saf işlevleri, `suggestForProduct` — Anthropic istemcisi enjekte), `applySuggestion` yönetim servisi, `products.marketplace_attrs`, ürün sayfasında istemci paneli, yeni ürün sayfasında "Fotoğraflarla başla".

**Tech Stack:** `@anthropic-ai/sdk` 1.6 (`client.beta.messages.parse`, `betaZodOutputFormat`), zod 4, Next.js 16, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-ai-asistan-design.md`

## Global Constraints

- Model `claude-opus-5-5`, effort `medium`, `max_tokens` 8000, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`.
- Görseller: her renkten ≤ 3, toplam ≤ 8, 800 px WebP base64; yalnız `p/<uuid>` anahtarları.
- Sınır 60/saat/yönetici; günlük `ai.product_suggest` (input/output token).
- Yeni ortam değişkeni `ANTHROPIC_API_KEY`: `src/env.ts` + `deploy/docker-compose.prod.yml`.
- Metinler Türkçe; renk/tipografi kuralları; `min-h-11`.

## Review Focus

1. Model listede olmayan kategori/renk/N11 değeri döndürürse uygulanmamalı → Task 2 testi.
2. Başka ürünün renk kimliğiyle uygulama yapılamamalı → Task 3 testi.
3. `refusal` / anahtar yok / görsel yok durumları anlaşılır hata vermeli → Task 2 testi.
4. Ürün N11 özelliği kategori özelliğini ezmeli, zorunlu kontrolü bozmamalı → Task 3 testi.
5. "Fotoğraflarla başla" yarım kalırsa (görsel hatası) taslak ürün tutarlı kalmalı → Task 4: önce ürün+renk, sonra görseller; hata mesajı ürüne yönlendirir.

### Task 1: Şema + ortam
- `products.marketplaceAttrs` jsonb `$type<{ n11?: MarketplaceAttr[] }>()` default `{}`; migration 0016; env `ANTHROPIC_API_KEY` (opsiyonel); compose.
- Commit `feat: urun pazaryeri ozellikleri alani, ANTHROPIC_API_KEY`.

### Task 2: Asistan çekirdeği
**Files:** `src/server/ai/product-assistant.ts`, `tests/services/product-assistant.test.ts`
**Produces:** `type AssistantClient = { beta: { messages: { parse: Anthropic["beta"]["messages"]["parse"] } } }`; `suggestionSchema(ctx)`; `validateSuggestion(raw, ctx): Suggestion`; `suggestForProduct(adminCtx, productId, deps: { client?: AssistantClient; n11?: N11Api | null }): Promise<Suggestion>`; `AiAssistantError`.
- Testler: `geçersiz kategori/renk/N11 değeri atılır`; `serbest metne izin vermeyen özellikte customValue atılır`; `görselsiz ürün hata`; `refusal anlaşılır hata`; `istek: model, effort, fallbacks, görsel sayısı ≤ 8, webp`; `kullanım günlüğe yazılır`.

### Task 3: Uygulama + N11 birleştirme
**Files:** `src/server/services/admin/ai-assistant.ts` (`applySuggestion(ctx, productId, input)`), `src/server/marketplaces/n11/listing.ts` (ürün özellikleri), `src/server/services/admin/n11.ts` (ürün özelliklerini geçir), testler.
- Testler: `yalnız seçilen alanlar değişir`; `başka ürünün rengi reddedilir`; `N11 özellikleri saklanır`; `ürün özelliği kategori özelliğini ezer`.

### Task 4: Ekranlar
- `src/components/admin/product/AiAssistantPanel.tsx` (öner → seçimli uygula), ürün sayfasında bölüm; `?asistan=1` ile otomatik başlat.
- `src/components/admin/product/PhotoStartForm.tsx` + action `startWithPhotosAction` (fiyat + 1–6 görsel → taslak ürün → yönlendirme).
- tsc, build, test; yerel ekran denemesi (sahte anahtar olmadan düğme durum metni).

### Task 5: Belgeler + inceleme + canlı (anahtar gelince)
