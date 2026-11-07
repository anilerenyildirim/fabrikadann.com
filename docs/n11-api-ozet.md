# N11 REST API — implementation reference (summary)

Source: n11 "API REFERANS DOKÜMANTASYONU" v10 (`n11APISoapREFERANSDOKUMANTASYONU_v10_0.pdf`, repo root). Only the REST services needed for our integration (product upload, price/stock sync, order read) are covered here. Anything the doc does not state is marked **not specified in doc**. Turkish field names/values are kept exactly as in the doc.

Background (doc §1): n11 started moving from SOAP to REST in April 2024; Kategori, Ürün and Sipariş services are REST now. SOAP product create/update is **closed** ("Ürün Yükleme ve Güncelleme Servisleri SOAP'tan kapatılmıştır"). Other services (shipment templates, cancel/return claims, catalog search, invoices) are still SOAP. Web version of the REST docs: https://magazadestek.n11.com/satis-surecleri?id=1006

---

## 0. Common

### Base URL / environments
- Production base: `https://api.n11.com`
- **Test/sandbox environment: not specified in doc.**
- **IP whitelisting: not specified in doc.**

### Authentication (doc §2)
- Every seller gets an API key + API secret, created in Satıcı Paneli → **Hesabım > API Hesapları**. Secret can be renewed, account can be deleted. Both must be sent with every call.
- REST: "Authorization: No Auth" (no Bearer/Basic). Credentials go in **HTTP headers**. Doc wording: "Headers alanına appkey ve appsecret bilgisini eklemeniz gerekir."
  - Header names as written in doc: **`appkey`** and **`appsecret`** (lowercase; doc gives no other spelling/casing — HTTP header names are case-insensitive anyway).
  - Category endpoints (§3.1, §3.2) only say "Headers: appkey bilgisi eklenmelidir" — i.e. only `appkey` is mentioned there. Sending both is harmless (assumption, not in doc).
- SOAP services use `<auth><appKey>…</appKey><appSecret>…</appSecret></auth>` in the body (not relevant for REST).
- Request bodies: JSON, "body de raw" → send `Content-Type: application/json` (content-type header itself not specified in doc).

### Error format
- REST error response format (HTTP codes, error body): **not specified in doc.**
- Product task endpoints return `status: "REJECT"` with `reasons: [string]` when the batch is not accepted (see §2.4).
- Order update returns per-line `status` + `reasons` (see §7).

### Rate limits
- Order list (`shipmentPackages`): **max 1000 requests per minute**.
- Product create / update / price-stock: **max 1000 SKUs per request**. Request-per-minute limit: not specified in doc.
- Category, product-query, task-details: rate limit not specified in doc.

### Integrator name
All product task payloads require `payload.integrator` (string): "API Kullanıcı/Entegratör Firma ismini yazınız. Tüm gönderimlerinizde aynı ismi iletiniz." — use one fixed value (e.g. `"fabrikadann"`) everywhere.

---

## 1. Categories

### 1.1 Category tree — GetCategories
- `GET https://api.n11.com/cdn/categories`
- Headers: `appkey`
- Params: none.
- Returns the whole n11 category tree in one request.
- **Leaf identification:** "subCategories değeri null ise, bu, o kategorinin en alt düzey olduğunu gösterir." Product create must use a **leaf** (en alt düzey) category id.
- Response JSON example: **not given in doc.** Known fields from the text: `id`, `subCategories` (null on leaves). Other fields (e.g. name) not specified in doc.
- Pagination: none (single response).

### 1.2 Category attributes — GetCategoryAttributesList
- `GET https://api.n11.com/cdn/category/{categoryId}/attribute`
- Headers: `appkey`
- Path param `categoryId` = `id` from the tree.
- Pagination: none.

Response example (trimmed, from doc):
```json
{
  "id": 1002571,
  "name": "Makyaj Çantası",
  "categoryAttributes": [
    {
      "attributeId": 1,
      "categoryId": 1002571,
      "attributeName": "Marka",
      "isMandatory": true,
      "isVariant": false,
      "isSlicer": false,
      "isCustomValue": true,
      "isN11Grouping": false,
      "attributeOrder": 1000,
      "attributeValues": [
        { "id": 8372688, "value": "Abay" },
        { "id": 6655098, "value": "Abbagift" }
      ]
    },
    {
      "attributeId": 429,
      "categoryId": 1002571,
      "attributeName": "Renk",
      "isMandatory": true,
      "isVariant": true,
      "isSlicer": true,
      "isCustomValue": true,
      "isN11Grouping": false,
      "attributeOrder": 102,
      "attributeValues": [
        { "id": 8773717, "value": "Ahşap Rengi" },
        { "id": 2523534, "value": "Altın" }
      ]
    }
  ]
}
```

Flag meanings (doc §3.2 + §3.4 notes):
| Flag | Meaning |
|---|---|
| `isMandatory: true` | Must be sent on **every SKU** in product-create. |
| `isCustomValue: false` | Must send `valueId` (an `attributeValues[].id`). |
| `isCustomValue: true` | Send either `valueId` **or** a free-text `customValue`. |
| `isVariant: true` | SKUs with the same `productMainId` show as selectable options (ürün seçeneği) on one page. If SKUs within one product group send **duplicate** values for variant attributes, it is not treated as distinct and the request is **rejected**. |
| `isSlicer: true` | SKUs with the same `productMainId` show on the same page as image-based options (görselli seçenek). "Bu değeri bilgi amaçlı kullanabilirsiniz." |
| `isN11Grouping` | Meaning not specified in doc. |
| `attributeOrder` | Display order (not further specified in doc). |

Notes:
- **Brand is an attribute**, not a separate field: `attributeId: 1` = `"Marka"` (mandatory, custom value allowed in the example). There is no `brand` field in the product payload.
- Color is `attributeId: 429` = `"Renk"` (isVariant + isSlicer in the example).
- Size attribute id for shoes: not in doc. The order example shows a shoe line with `variantAttributes` `"Numara"` and `"Renk"`, so the shoe size attribute is named **"Numara"**; its `attributeId` must be read from the attribute service for the chosen shoe category.

---

## 2. Product create — CreateProduct

- `POST https://api.n11.com/ms/product/tasks/product-create`
- Headers: `appkey`, `appsecret`. Body: raw JSON.
- Max **1000 SKUs per request**.
- Asynchronous: response returns a task `id`; check result with Task Details (§2.4).

### 2.1 Payload fields (`payload.skus[]`)

| Field | Required | Type | Notes (from doc) |
|---|---|---|---|
| `payload.integrator` | Evet | string | Integrator/company name; same value in all calls. |
| `title` | Evet | string | Product name; "Marka-cinsiyet renk veya ürün bilgisini eklerek yazabilirsiniz." Max length not specified in doc. |
| `description` | Evet | HTML-string | Product description (HTML allowed). |
| `categoryId` | Evet | long | Leaf category id. |
| `currencyType` | Evet | string | `TL`, `USD`, `EUR`. USD/EUR converted with Merkez Bankası rate. |
| `productMainId` | Evet | string | **Grouping key.** Same id for all models of one product. "Varyantlı ürün açmak için Renk ve Beden tüm değeri için aynı değer eklenmelidir. Bu renkleri aynı sayfada toplarken bedenleri varyantlı açılmasını sağlar." |
| `preparingDay` | Evet | integer | Days needed before handing to cargo. |
| `shipmentTemplate` | Evet | string (type blank in doc table) | **Name** of the shipping template created in panel: Hesabım > Teslimat Bilgilerim. |
| `maxPurchaseQuantity` | Hayır | integer | Max quantity per buyer. |
| `stockCode` | Evet | string | Seller's unique SKU code, **max 255**. All later price/stock updates are keyed on `stockCode`. |
| `catalogId` | Hayır | long | n11 catalog id. |
| `barcode` | Hayır | string | Only **national barcodes** (ulusal barkod) are saved, without error otherwise. Used to match n11 catalog. (Example sends it as a number and sometimes as the string `"null"`.) |
| `quantity` | Evet | integer | Stock, **max 999.999** (i.e. 999,999). |
| `images[]` | Evet | list of `{url, order}` | `url` must be **SSL "https"** URLs; `order` = image order (examples use 0 and 1). **Max image size 10 MB (10.240 KB).** Max number of images, dimensions, formats: not specified in doc. |
| `attributes[]` | Evet | list of `{id, valueId, customValue}` | All `isMandatory: true` attributes required. Table names the id field "attributesid" but the JSON uses **`id`** (= `attributeId`). |
| `attributes[].id` | Evet | long | `attributeId` from the attribute service. |
| `attributes[].valueId` | Evet* | long | Required when `isCustomValue: false`. Otherwise may be `null`. |
| `attributes[].customValue` | Evet* | string | Free text, allowed when `isCustomValue: true`. Examples send `null` or the **string** `"null"` when unused. |
| `salePrice` | Evet | amount | Sale price (TSF). |
| `listPrice` | Evet | amount | List price (PSF), shown struck-through when sale price is lower. |
| `vatRate` | Evet | integer | One of `0`, `1`, `10`, `20`. |

Doc notes:
- **Buybox:** if `barcode` matches a barcode in the n11 catalog, the product opens in **"satıcı onayı bekliyor"** status regardless of attributes.
- Field for "brand": none — send `Marka` attribute (id 1).
- Price format for create (decimals): not specified for create; price-stock-update requires dot decimal separator with 2 digits (see §4) — safest to use the same.

### 2.2 Variant grouping (how colors/sizes of one model are grouped)
- Group key = **`productMainId`**. Every SKU (each color × size) is its own entry in `skus[]` with its own unique `stockCode`, and all SKUs of one model share the same `productMainId`.
- Attributes with `isVariant: true` (e.g. size) become selectable options on the same page; `isSlicer: true` (e.g. Renk) show as image-based options on the same page.
- In the doc's variant example (dress, `productMainId: "1122"`, category `1209218`): 4 SKUs = 2 colors (`429` → `"Mavi"`, `"Yeşil"`) × 2 sizes (attribute `1494` → `valueId` `4093868` / `4093852`), stockCodes `22211112S`, `22211112M`, `222111121S`, `222111121M`. Each SKU repeats title, description, images, all attributes and prices. Title of the green SKU contains "Yeşil" (one SKU in the example still says "Mavi" — doc typo).
- Each variant combination must be unique within the group (duplicate variant values → reject).

### 2.3 Request / response examples

Single SKU (trimmed from doc):
```json
{
  "payload": {
    "integrator": "Entegratör isminizi yazınız",
    "skus": [
      {
        "title": "Realme C55 8 GB 256 GB (Realme Türkiye Garantili) md0123278",
        "description": "BB test test",
        "categoryId": 1000476,
        "currencyType": "TL",
        "productMainId": "test1",
        "preparingDay": 3,
        "shipmentTemplate": "1",
        "maxPurchaseQuantity": 5,
        "stockCode": "md01g4141",
        "catalogId": null,
        "barcode": 8806094924862,
        "quantity": 10,
        "images": [
          { "url": "https://n11scdn.akamaized.net/a1/602_857/15/94/31/26/IMG-4582034240738960980.jpg", "order": 1 },
          { "url": "https://images.secretlab.co/theme/common/collab_pokemon_catalog_charizard-min.png", "order": 0 }
        ],
        "attributes": [
          { "id": 1,   "valueId": null, "customValue": "Realme" },
          { "id": 429, "valueId": null, "customValue": "Beyaz" }
        ],
        "salePrice": 2000,
        "listPrice": 2200,
        "vatRate": 10
      }
    ]
  }
}
```

Variant SKU (one of four, trimmed):
```json
{
  "title": "Bisiklet Yaka Çicek Desenli Elbise Mavi A11-2",
  "description": "B5555544",
  "categoryId": 1209218,
  "currencyType": "TL",
  "productMainId": "1122",
  "preparingDay": 3,
  "shipmentTemplate": "1",
  "maxPurchaseQuantity": 5,
  "stockCode": "22211112S",
  "catalogId": null,
  "barcode": null,
  "quantity": 10,
  "images": [ { "url": "https://…/IMG-4582034240738960980.jpg", "order": 0 } ],
  "attributes": [
    { "id": 1,    "valueId": null,    "customValue": "Mağaza7" },
    { "id": 429,  "valueId": null,    "customValue": "Mavi" },
    { "id": 220,  "valueId": 6397019, "customValue": "null" },
    { "id": 1494, "valueId": 4093868, "customValue": "null" }
  ],
  "salePrice": 2000,
  "listPrice": 2200,
  "vatRate": 10
}
```

Response:
```json
{ "id": 1092, "type": "PRODUCT_CREATE", "status": "IN_QUEUE", "reasons": ["1 sku işlenmeye alındı."] }
```

| Response field | Type | Meaning |
|---|---|---|
| `id` | long | Task id → query Task Details with it. |
| `type` | string | `PRODUCT_CREATE` (create), `SKU_UPDATE` (price/stock), `PRODUCT_UPDATE` (update). |
| `status` | string | `IN_QUEUE` = accepted, being processed; `REJECT` = not processed, see `reasons`. |
| `reasons` | list of string | Explanation. |

### 2.3b "Hızlı Ürün Yükleme" (quick upload from n11 catalog)
Same endpoint. Send `catalogId` (from SOAP `searchCatalog`) or `barcode`; one is required, `catalogId` wins if both. `images` and `attributes` must be sent as empty arrays `[]` (mandatory). `shipmentTemplate` still required per product. Catalog description overrides ours if the catalog has one. If the barcode's n11 category differs from our `categoryId`, product goes to Aksiyon Bekleyenler > **Satıcı Onayı Bekliyor** and must be approved in the panel. (Unlikely relevant: our shoes have no national barcodes / catalog entries.)

### 2.4 Task Details (result of create / update / price-stock)
- `POST https://api.n11.com/ms/product/task-details/page-query`
- Headers: `appkey`, `appsecret`. Body: raw JSON.
- Doc says it's for UpdateProduct and UpdateProductPriceAndStock tasks; CreateProduct section also says to check results with TaskDetail.

Request:
```json
{ "taskId": 362, "pageable": { "page": 0, "size": 1000 } }
```
Response (trimmed):
```json
{
  "taskId": 1095,
  "skus": {
    "content": [
      {
        "id": 1585,
        "taskId": 1095,
        "ownerId": 2770263,
        "itemCode": "1234567m",
        "status": "SUCCESS",
        "sku": {
          "salePrice": 1100.00,
          "listPrice": 1200.00,
          "currencyType": "TL",
          "reasons": ["Başarıyla tamamlandı."],
          "stock": 9
        },
        "reasons": ["Başarıyla tamamlandı."]
      }
    ],
    "pageable": { "offset": 0, "pageNumber": 0, "pageSize": 100000, "paged": true, "unpaged": false },
    "last": true,
    "totalElements": 1,
    "totalPages": 1,
    "first": true,
    "number": 0,
    "numberOfElements": 1,
    "size": 100000,
    "empty": false
  },
  "createdDate": "12-08-2024 06:12:05",
  "modifiedDate": "12-08-2024 06:12:11",
  "status": "PROCESSED"
}
```
- Task-level `status`: `PROCESSED` (done), `IN_QUEUE` (processing), `REJECT` (not processed).
- Per-SKU `skus.content[].status`: doc says "Fail ve SUCCESS" (exact casing of the failure value: written as "Fail" — not confirmed by an example). `itemCode` = our `stockCode`. `reasons` explain failures.
- Pagination: Spring-style (`page`, `size` in request; `totalPages`, `last` in response). Max size not specified in doc.
- Date format `dd-MM-yyyy HH:mm:ss` (from example). Polling interval / how long tasks take: not specified in doc.

---

## 3. Product query — GetProductQuery

- `GET https://api.n11.com/ms/product-query`
- Headers: `appkey`, `appsecret`.
- No parameter is required. No params → all seller products, page 0, size 20.

| Query param | Type | Values / meaning |
|---|---|---|
| `id` | long | N11 product code |
| `productMainId` | string | Group code |
| `stockCode` | string | Seller SKU code — **one value per request** |
| `saleStatus` | string | `Before_Sale`, `On_Sale`, `Out_Of_Stock`, `Sale_Closed` |
| `productStatus` | string | `Active`, `InCatalogApproval`, `Suspended`, `CatalogRejected`, `Unlisted`, `Prohibited`, `InApproval` |
| `brandName` | string | Brand name |
| `categoryIds` | long list | Category ids |
| `page` | int | Default 0 |
| `size` | int | Default 20, **max 50** |

Example: `GET https://api.n11.com/ms/product-query?id=&productMainId=&stockCode=&saleStatus=&productStatus=&brandName=&categoryIds=`

Response (trimmed):
```json
{
  "content": [
    {
      "n11ProductId": 123456789,
      "sellerId": 0,
      "stockCode": "TestSKU123",
      "title": "Test Ürünü Kontrol Amaçlı Gri",
      "description": "Açıklama bilgisi uzun açıklama",
      "categoryId": 1231231,
      "productMainId": "GrupKoduModellemeİçin",
      "status": "Active",
      "saleStatus": "On_Sale",
      "preparingDay": 3,
      "shipmentTemplate": "1",
      "maxPurchaseQuantity": 5,
      "customTextOptions": [],
      "catalogId": 987654321,
      "barcode": null,
      "groupId": 12345678,
      "currencyType": "TL",
      "salePrice": 10000.0,
      "listPrice": 10000,
      "quantity": 2,
      "attributes": [
        { "attributeId": 1,   "attributeName": "Marka", "attributeValue": "Diğer" },
        { "attributeId": 429, "attributeName": "Renk",  "attributeValue": "Gri" }
      ]
    }
  ],
  "pageable": { "sort": null, "pageNumber": 0, "pageSize": 20, "offset": 0, "paged": true, "unpaged": false },
  "last": true,
  "totalElements": 1,
  "totalPages": 1,
  "first": true,
  "number": 0,
  "sort": null,
  "numberOfElements": 1,
  "size": 20,
  "empty": false
}
```
- One row per SKU (has `stockCode`, `quantity`, prices). `groupId` appears in the example but is not described.
- Pagination: start at page 0, use `totalPages`; a page with empty `content` is the last page.
- Gotcha: field lengths/types may grow (e.g. `n11ProductId` 9 → 10 digits) — store ids as bigint/string.

---

## 4. Price & stock update — UpdateProductPriceAndStock

- `POST https://api.n11.com/ms/product/tasks/price-stock-update`
- Headers: `appkey`, `appsecret`. Body: raw JSON.
- Max **1000 SKUs per request**. Async → task id, check with Task Details (§2.4).

| Field | Required | Type | Notes |
|---|---|---|---|
| `payload.integrator` | Evet | string | Same name in all calls |
| `stockCode` | Evet | string | SKU key |
| `listPrice` | Hayır | number | PSF |
| `salePrice` | Hayır | number | TSF |
| `quantity` | Hayır | integer | Stock |
| `currencyType` | Hayır | text | `TL`, `USD`, `EUR` |

Rules (doc):
- For a price update, **`listPrice` and `salePrice` must be sent together.**
- Decimal separator must be a **dot**; comma causes an error.
- Decimals must have **2 digits after the dot**, otherwise the request gets `REJECT`. (Doc examples nevertheless use integers like `2000`.)
- Fields you omit are not updated → stock-only update = send only `stockCode` + `quantity`.
- `listPrice` and `salePrice` may be equal; doc also says "listPrice, salePrice'dan yüksek olmalıdır. Aksi takdirde isteğiniz REJECT alacaktır." → effectively **listPrice ≥ salePrice**, never lower.

Request:
```json
{
  "payload": {
    "integrator": "Entegratör isminizi yazınız",
    "skus": [
      { "stockCode": "test_variant_ea1_1", "listPrice": 2000, "salePrice": 1600, "quantity": 2, "currencyType": "TL" },
      { "stockCode": "test_variant_ea1_2", "listPrice": 2200, "salePrice": 1800, "quantity": 1, "currencyType": "TL" }
    ]
  }
}
```
Response:
```json
{ "id": 1092, "type": "SKU_UPDATE", "status": "IN_QUEUE", "reasons": ["1 sku işlenmeye alındı."] }
```
Status: `IN_QUEUE` (queued; query Task Details), `REJECT` (not loaded; see `reasons`).

---

## 5. Product update — UpdateProduct

- `POST https://api.n11.com/ms/product/tasks/product-update`
- Headers: `appkey`, `appsecret`. Body: raw JSON. Max **1000 SKUs per request**. Async → task id.

Fields that can change (this is the full list in the doc):
| Field | Required | Type | Notes |
|---|---|---|---|
| `payload.integrator` | Evet | string | |
| `stockCode` | Evet | string | SKU key |
| `status` | Hayır | string | `"Active"` (on sale) / `"Suspended"` (take off sale) |
| `preparingDay` | Hayır | integer | Must be > 0 |
| `shipmentTemplate` | Hayır | string | "Şablon Adı" from Hesabım > Teslimat Bilgileri |
| `currencyType` | Hayır | string | `TL`, `USD`, `EUR` |
| `deleteProductMainId` | Hayır | boolean | Must be `true` to change `productMainId`; `false` → no change |
| `productMainId` | Hayır | string | Group code (grouping) |
| `deleteMaxPurchaseQuantity` | Hayır | boolean | Must be `true` to change `maxPurchaseQuantity`; `false` → no change |
| `maxPurchaseQuantity` | Hayır | integer | |
| `description` | Hayır | string | |
| `vatRate` | Evet (per table) | integer | `0`, `1`, `10`, `20` — table marks it required but the example omits it |

**Not updatable via this endpoint per the doc:** `title`, `images`, `attributes`, `categoryId`, `barcode`. (Prices/stock go through §4.) How to change title/images/attributes: not specified in doc.

Request:
```json
{
  "payload": {
    "integrator": "Entegratör İsmini yazabilirsiniz",
    "skus": [
      {
        "stockCode": "xyz-1",
        "status": "Active",
        "preparingDay": 3,
        "shipmentTemplate": "STANDART",
        "deleteProductMainId": true,
        "productMainId": "ea_v_xyz",
        "deleteMaxPurchaseQuantity": false,
        "maxPurchaseQuantity": 3,
        "description": "Test Ürün Açıklaması"
      }
    ]
  }
}
```
Response: `{ "id": 1092, "type": "PRODUCT_UPDATE", "status": "IN_QUEUE", "reasons": ["1 sku işlenmeye alındı."] }`

---

## 6. Order list — GetShipmentPackages

- `GET https://api.n11.com/rest/delivery/v1/shipmentPackages`
- Headers: `appkey`, `appsecret`.
- Rate limit: **max 1000 requests / minute.**
- One record = one **package** (`id` = paket numarası); one order (`orderNumber`) can have several packages (e.g. after split).

### 6.1 Query params
| Param | Type | Notes |
|---|---|---|
| `startDate` | long (timestamp ms) | **Milliseconds, GMT+3.** Orders after this date. |
| `endDate` | long (timestamp ms) | Milliseconds, GMT+3. Orders up to this date. |
| `page` | int | Page index (starts at 0). |
| `size` | int | **Max 100.** |
| `orderNumber` | string | Filter by order number. |
| `packageIds` | string | Filter by package number. |
| `status` | string | `Created`, `Picking`, `Shipped`, `Cancelled`, `Delivered`, `UnPacked`, `UnSupplied` — **one value per request**. |
| `orderByDirection` | string | `ASC` (old → new) / `DESC` (new → old). |
| `orderByField` | boolean | `true` → date params filter/sort by **package last-update date** (son güncelleme tarihi). Example URL spells it `orderbyField`. |

Date-window rules:
- Only `startDate` → next **1 month** after it.
- Only `endDate` → **1 month** before it.
- Both, but far apart (e.g. 6 months) → only the last 1 month before `endDate`.
- **Orders before November 2024 are not returned.**
- Results are sorted by last update date.

Pagination: start at page 0, use `totalPages`; an empty `content` page = last page.

Example: `GET https://api.n11.com/rest/delivery/v1/shipmentPackages?startDate={startDate}&endDate={endDate}&status=Created&orderByField=true&orderByDirection=ASC&page=0&size=100`

### 6.2 Response (trimmed from doc — note the example is a shoe order)
```json
{
  "totalElements": 1,
  "totalPages": 1,
  "page": 0,
  "size": 100,
  "content": [
    {
      "billingAddress": {
        "address": "…", "city": "İstanbul", "district": "Sarıyer", "neighborhood": "Reşitpaşa",
        "fullName": "N11 müşteri", "gsm": "5xxxxxxxxx", "tcId": "11111111111",
        "postalCode": "34000", "taxId": null, "taxHouse": null, "invoiceType": 1
      },
      "shippingAddress": {
        "address": "…", "city": "İstanbul", "district": "Sarıyer", "neighborhood": "Reşitpaşa",
        "fullName": "N11 müşteri", "gsm": "5xxxxxxxxx", "tcId": "11111111111", "postalCode": "34000"
      },
      "orderNumber": "203872347637",
      "id": "112999455244259",
      "customerEmail": "n11@n11.com",
      "customerfullName": "N11 müşteri",
      "customerId": 12345678,
      "taxId": "",
      "taxOffice": "",
      "tcIdentityNumber": "11111111111",
      "cargoSenderNumber": null,
      "cargoTrackingNumber": "112999455244259",
      "cargoTrackingLink": "",
      "shipmentCompanyId": 342,
      "cargoProviderName": "MNG Kargo",
      "shipmentMethod": 1,
      "installmentChargeWithVATprice": 0.00,
      "lines": [
        {
          "quantity": 2,
          "productId": 123456789,
          "productName": "Erkek Spor Ayakkabı Bordo 45",
          "stockCode": "20242024",
          "variantAttributes": [
            { "name": "Numara", "value": "45" },
            { "name": "Renk", "value": "Bordo" }
          ],
          "customTextOptionValues": [],
          "price": 292.8,
          "dueAmount": 536.20,
          "installmentChargeWithVAT": 0,
          "sellerCouponDiscount": 0,
          "sellerDiscount": 2.9,
          "mallDiscount": 43.60,
          "sellerInvoiceAmount": 579.8,
          "totalMallDiscountPrice": 43.60,
          "orderLineId": 415490391,
          "orderItemLineItemStatusName": "Picking",
          "totalSellerDiscountPrice": 5.8
        }
      ],
      "lastModifiedDate": 1724323386203,
      "agreedDeliveryDate": 1725310828346,
      "totalAmount": 1479.79,
      "totalDiscountAmount": 62.3,
      "packageHistories": [
        { "createdDate": 1724274054460, "status": "Created" },
        { "createdDate": 1724274255751, "status": "Picking" },
        { "createdDate": 1724274492082, "status": "Shipped" },
        { "createdDate": 1724396400000, "status": "Delivered" }
      ],
      "shipmentPackageStatus": "Delivered",
      "sellerId": 9876543
    }
  ]
}
```

Field meanings (doc table):
- Package: `id` paket numarası; `orderNumber` sipariş numarası; `shipmentPackageStatus` sipariş statüsü; `packageHistories[]` past statuses with dates; `lastModifiedDate` son hareket tarihi; `agreedDeliveryDate` "Sipariş onaylanma tarihi" (per doc); `totalAmount`, `totalDiscountAmount`; `billingAddress.invoiceType` 1 Bireysel / 2 Kurumsal; `shipmentMethod` 1 Kargo / 2 Diğer; `shipmentCompanyId`, `cargoProviderName`; `cargoTrackingNumber` kargo barkod no / kampanya kodu; `cargoSenderNumber` kargo takip no; `cargoTrackingLink`.
- Line: `quantity`; `productId` N11 ürün kodu; `productName`; **`stockCode`** (our SKU — use this to decrement stock; there is **no barcode field on lines**); `variantAttributes`; `price` unit price excl. discounts; `dueAmount` tahsil edilecek tutar; `sellerCouponDiscount`, `sellerDiscount`, `totalSellerDiscountPrice` (store discounts); `mallDiscount`, `totalMallDiscountPrice` (n11 discounts); `sellerInvoiceAmount` mağaza fatura tutarı; `orderLineId` (needed for order update/split); `orderItemLineItemStatusName` line status.
- Invoice total = sum of lines' `sellerInvoiceAmount`. Line amount formula: `(price * quantity) - totalSellerDiscountPrice`.
- Timestamps in responses are epoch milliseconds.
- Gotcha: field lengths may grow (`orderNumber` 12 → 13 digits). `id` is a string in the example, `orderLineId` a number.
- Example quirk: `packageHistories` statuses have a leading space in the doc (`" Shipped"`) — trim before comparing.

### 6.3 Status values
Package statuses (filter values for `status` / `shipmentPackageStatus`): `Created`, `Picking`, `Shipped`, `Cancelled`, `Delivered`, `UnPacked`, `UnSupplied`. The doc does **not** define each one; what it does say:
| Status | What the doc says / implies |
|---|---|
| `Created` | New order; these lines can be approved via UpdateOrder (§7). Packages in `Created` cannot be split. |
| `Picking` | "Onaylandı statüsü" — approved by seller (via UpdateOrder or auto-approval). |
| `Shipped` | Appears in history between Picking and Delivered (meaning not defined in doc; literally shipped). |
| `Delivered` | Final status in history example (literally delivered). |
| `Cancelled` | Not defined in doc beyond the name → **cancelled**. |
| `UnPacked` | Set on the **original package after a split**; the split-off packages are created as `Picking`. Not a cancellation — do not restock on it. |
| `UnSupplied` | Not defined in doc (name suggests "could not be supplied by seller"). |

- Line status `orderItemLineItemStatusName`: list of values **not specified in doc** (example: `"Picking"`).
- **Returns are not a package status** in this REST service. Returns are handled by the SOAP **ReturnService** (`ClaimReturnList`, statuses `REQUESTED`, `APPROVAL_WAITING` (search-only), `CANCELLED`, `DENIED`, `PENDING`, `PENDED`, `APPROVED`, `MANUAL_REFUND`, `ALL`); cancellation requests by the SOAP **ClaimCancelService**. Out of scope here.
- For our stock logic: decrement on a new package (`Created`/`Picking`), restore stock on `Cancelled` (and probably `UnSupplied` — doc does not confirm). Returns require ReturnService (`APPROVED`).

---

## 7. Order update — UpdateOrder (brief)

- `PUT https://api.n11.com/rest/order/v1/update`
- Headers: `appkey`, `appsecret`. Body: raw JSON.
- Currently **only `Picking`** is supported (= approve lines). Other status changes "ilerleyen süreçte" (later).
- Only lines whose package status is `Created` can be updated.
- `lineId` = `orderLineId` from shipmentPackages. Multiple lines per request, one `status` for all. Invalid lines return an error message; the rest are processed (partial success).
- Sellers who want **auto-approval** without calling this can email `sellerintegration@n11.com`.

Request:
```json
{ "lines": [ { "lineId": 426659152 }, { "lineId": 426659151 } ], "status": "Picking" }
```
Response:
```json
{
  "content": [
    { "lineId": 426659152, "status": "SUCCESS", "reasons": "Başarıyla tamamlandı." },
    { "lineId": 426659151, "status": "SUCCESS", "reasons": "Başarıyla tamamlandı." }
  ]
}
```
(Here `reasons` is a string, unlike the product task responses where it is an array.) Failure `status` value: not specified in doc.

Related (not requested, FYI): `POST https://api.n11.com/rest/delivery/v1/splitCombinePackage` — split a `Picking` package by `orderLineIds` (`{"splitGroups":[{"orderLineIds":[…]}]}` → `{"code":200,"message":"success"}`).

---

## 8. Shipping template (kargo şablonu) setup
- `shipmentTemplate` is **required on product create** and is the template **name** (not an id), as created in the seller panel under **Hesabım > Teslimat Bilgilerim / Teslimat Bilgileri** ("Şablon Adı"). Doc examples use `"1"` and `"STANDART"`.
- The template must exist in the panel before uploading; creating it via API is not described for REST. The SOAP `ShipmentService.GetShipmentTemplate` (by `name`) can read a template's details (cities, `deliveryFeeType`: 1 alıcı öder, 2 mağaza öder, 3 şartlı kargo, 4 N11 öder).

---

## 9. Gotchas (collected)
1. **No sandbox** is documented; all URLs are production. IP whitelisting not mentioned.
2. All product writes are **async tasks**: an `IN_QUEUE` response does not mean success — poll Task Details and check per-SKU `status` (`SUCCESS`/Fail) and `reasons`.
3. **`stockCode` is the only key** for later price/stock/product updates — must be unique per SKU (size × color) and stable. Max 255 chars.
4. **Grouping = `productMainId`**; each size/color is a separate SKU. Duplicate variant-attribute combos within a group → reject. Changing `productMainId` later requires `deleteProductMainId: true`.
5. **Brand = attribute id 1 ("Marka")**, color = attribute 429 ("Renk"); shoe size appears as "Numara" — read ids per leaf category. Mandatory attributes must be present on every SKU; `isCustomValue: false` attributes need `valueId`.
6. Only **leaf categories** (`subCategories == null`).
7. Images: **https only**, ≤ 10 MB each; count/dimension limits not in doc. Images cannot be changed via product-update per the doc.
8. Prices: dot decimal, **2 decimals**, send `listPrice` + `salePrice` together, `listPrice` never below `salePrice`. Our prices are kuruş integers → format as `(kurus/100).toFixed(2)`. VAT must be 0/1/10/20.
9. `quantity` ≤ 999,999.
10. `barcode`: only national (GS1) barcodes are stored; a catalog match puts the product into "satıcı onayı bekliyor". Our internal `29…` production barcodes are in-store EAN-13 range — likely not "national"; safest to omit (doc does not say what happens).
11. Max **1000 SKUs** per product/price-stock request; product-query max `size` 50 and only one `stockCode` per call; order list max `size` 100, **1000 req/min**, **1-month date window**, ms timestamps in **GMT+3**, one `status` per call, no data before Nov 2024.
12. To catch cancellations, query with `orderByField=true` (by last-update date) per status, or re-read packages by `orderNumber`, since the default date filter follows a different date (not explicitly specified which).
13. Order lines carry `stockCode`, not barcode.
14. Default flow requires approving new orders (`Created` → `Picking`) via UpdateOrder or by requesting auto-approval from `sellerintegration@n11.com`.
15. Doc inconsistencies: `attributesid` (table) vs `id` (JSON); `customValue` sent as string `"null"`; `orderByField` vs `orderbyField`; `vatRate` required in update table but missing in example; per-SKU failure status written as "Fail".
