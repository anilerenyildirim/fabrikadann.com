# AI Asistan (fotoğraftan ürün bilgisi önerisi) — tasarım

Tarih: 08.11.2026 · Dal: `magaza-v1`

## Amaç

Ürün eklerken Trendyol'daki "AI Asistan" gibi: yönetici fotoğrafları yükler, asistan fotoğraflara bakıp ürün adı,
açıklama, malzeme ve bakım, kategori, renk adları ve pazaryeri (N11) özelliklerini önerir; yönetici inceleyip uygular.
Böylece ürünler sitede doğru ve eksiksiz oluşturulur ve siteden pazaryerlerine (N11; ardından Trendyol) gönderilebilir.

**Kullanıcının kararları:** dört öneri alanı da: ad + açıklama, malzeme ve bakım, kategori + renk adı, pazaryeri
özellikleri. Asistan hiçbir şeyi kendiliğinden kaydetmez; yönetici seçip uygular.

## Kapsam dışı

Trendyol'a ürün yükleme (ayrı iş; asistanın önerdiği ürün özelliklerini kullanacak), görsel düzenleme/arka plan
silme, fiyat önerisi, toplu (çok ürünlü) öneri.

## Model ve maliyet

- Claude API, model `claude-opus-5-5`, `client.beta.messages.parse` + `betaZodOutputFormat` (yapılandırılmış çıktı),
  `output_config.effort: "medium"`, `max_tokens: 8000`. Güvenlik reddinde sunucu tarafı yedek model:
  `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`; yine `refusal` dönerse anlaşılır hata.
- Girdi: ürünün görselleri (her renkten en fazla 3, toplam en fazla 8; 800 px WebP, base64), site kategorileri,
  renkler, eşlenmiş N11 kategorisinin özellikleri (otomatik doldurulanlar ve varyant özellikleri hariç; liste değerleri
  özellik başına en fazla 80). Tahmini maliyet ürün başına birkaç TL.
- Ortam: `ANTHROPIC_API_KEY` (`src/env.ts` + compose `environment:`). Tanımsızsa asistan düğmesi "AI Asistan için
  sunucuda ANTHROPIC_API_KEY tanımlayın." der.
- Sınır: yönetici başına saatte 60 öneri (`rateLimit`). Her öneri işlem günlüğüne (`ai.product_suggest`) token
  kullanımıyla yazılır.

## Çıktı şeması (zod)

```
{
  name: string (≤ 100),            // "Hakiki Deri Görünümlü Fermuarlı Kadın Bot" gibi; marka yok
  description: string (≤ 3000),    // düz metin, paragraflar boş satırla; abartı ve doğrulanamayan iddia yok
  details: string (≤ 1500),        // malzeme ve bakım; görünmeyen bilgi "kontrol edin" notuna
  categoryId: <site kategori kimlikleri enum> | null,
  colors: [{ colorId: <ürün renk kimlikleri enum>, name: string (≤ 40) }],
  n11Attributes: [{ id: number, valueId: number | null, customValue: string | null }],
  notes: string[] (≤ 6)            // yöneticinin doğrulaması gerekenler (ör. "Malzeme fotoğraftan kesin değil")
}
```

Sunucu doğrular: kategori/renk kimlikleri listede, N11 `valueId` o özelliğin listesinde, liste dışı değer yalnızca
serbest metne izin verilen özellikte. Geçersiz öğe atılır (notlara düşmez, sessizce).

## Veri

- `products.marketplace_attrs` jsonb (varsayılan `{}`): `{ n11?: MarketplaceAttr[] }` — ürüne özel pazaryeri
  özellikleri. N11 SKU oluştururken kategori eşlemesinin sabit özellikleriyle birleşir; aynı özellikte ürününki geçerli.
  Migration 0016.

## Akışlar

1. **Ürün sayfasında "AI Asistan" bölümü** (`/yonetim/urunler/[id]`, Bilgiler'in üstünde): "Fotoğraflardan öner"
   düğmesi → `suggestForProduct` → öneriler alan alan gösterilir (mevcut değerle yan yana, her alan için onay kutusu,
   varsayılan seçili; N11 özellikleri ad: değer listesi; notlar) → "Seçilenleri uygula" → `applySuggestion` (ad,
   açıklama, malzeme-bakım, kategori, renk adları, N11 özellikleri). Görsel yoksa düğme yerine "Önce renk ve görsel
   ekleyin".
2. **Fotoğraflarla başla** (`/yonetim/urunler/yeni` sayfasının başında): fiyat + 1–6 fotoğraf → taslak ürün
   ("Yeni ürün", tek renk "Renk 1", görseller) oluşturulur → ürün sayfasına `?asistan=1` ile gidilir ve öneri
   kendiliğinden başlar. Klasik form aynen kalır.
3. N11'e gönderimde `buildSkus` ürün özelliklerini kullanır.

## Güvenlik

- Tüm action'lar `requireAdmin` + servisler `assertAdmin`; girdiler zod.
- Modele yalnızca kendi depomuzdaki görseller (anahtar `p/<uuid>` doğrulanmış) gider; müşteri verisi gitmez.
- Model çıktısı kullanıcı HTML'i olarak render edilmez; düz metin alanlarına yazılır (mevcut kurallar).
- Uygulama yalnızca yöneticinin seçtiği alanları değiştirir; işlem günlüğüne yazılır.

## Test

- `buildPrompt`/`validateSuggestion` saf işlevleri: kimlik doğrulama, N11 değer doğrulama, kategori/renk enum'u.
- `suggestForProduct` sahte Anthropic istemcisiyle: görselsiz ürün hata; refusal anlaşılır hata; kullanım günlüğe.
- `applySuggestion`: yalnız seçilen alanlar; renk kimliği başka ürünün olamaz; N11 özellikleri saklanır.
- `buildSkus`: ürün özelliği kategori özelliğini ezer.
- Gerçek API denemesi: kullanıcı anahtarı girince yerelde bir ürünle (maliyet birkaç TL).
