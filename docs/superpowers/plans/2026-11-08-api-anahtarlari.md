# API anahtarları — uygulama planı

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Goal:** Ayarlar > API anahtarları: durum, son kullanma, sağlık denemesi, telefon bildirimi; Claude ve N11 anahtarları panelden şifreli.
**Spec:** `docs/superpowers/specs/2026-11-08-api-anahtarlari-design.md`

## Global Constraints
- AES-256-GCM, `SECRETS_KEY` base64 32 bayt; anahtar değeri hiçbir yanıtta, günlükte ya da hata mesajında yok.
- Panel > env önceliği; 60 sn önbellek, kayıtta temizlenir.
- Eşikler 7/3/1/0 gün; başarısız deneme bildirimi günde bir; kontrol saatte bir (bakım betiği).
- Yeni env: `src/env.ts` + compose.

## Review Focus
1. Anahtar değeri istemciye ya da günlüğe sızmamalı → Task 3 testi (günlük verisinde değer yok, listede yalnız son 4).
2. Bozuk/yanlış `SECRETS_KEY` ile şifreli kayıt okunamazsa env'e düşmeli, çökmemeli → Task 2 testi.
3. Aynı eşik bildirimi tekrar gitmemeli → Task 4 testi.
4. Yanlış anahtar kaydedilmemeli → Task 3 testi.
5. N11/Claude kullanan yerler panel anahtarını görmeli → Task 5 testi.

### Task 1: Şema, migration 0017, env, compose
### Task 2: `src/server/secrets.ts` + `tests/services/secrets.test.ts`
### Task 3: `src/server/services/admin/integrations.ts` (liste, kaydet, kaldır, son kullanma) + `tests/yonetim/integrations.test.ts`
### Task 4: `src/server/integrations/health.ts` (kontrol + bildirim) + bakım betiği + `tests/services/integration-health.test.ts`
### Task 5: Kullanan yerler `getSecret`'e (asistan, N11) + testler
### Task 6: Ekran `/yonetim/ayarlar/api-anahtarlari` + Ayarlar bağlantısı; tsc, build, test
### Task 7: Belgeler, inceleme, canlı (SECRETS_KEY üretimi, Claude son kullanma 14.11.2026 girişi)
