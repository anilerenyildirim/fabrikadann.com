import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const userRole = pgEnum("user_role", ["customer", "admin"]);
export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);
export const orderStatus = pgEnum("order_status", [
  "awaiting_payment",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);
export const paymentStatus = pgEnum("payment_status", ["pending", "succeeded", "failed"]);
export const cancelReason = pgEnum("cancel_reason", ["payment_expired", "admin"]);
export const stockReason = pgEnum("stock_reason", [
  "order",
  "cancel",
  "manual",
  "trendyol",
  "initial",
  "purchase",
  "supplier_return",
  "n11",
]);

// ---------- Kullanıcılar ve oturumlar ----------

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    role: userRole("role").notNull().default("customer"),
    totpSecret: text("totp_secret"),
    // Aynı TOTP kodunun ikinci kez kullanılmasını engeller
    totpLastStep: integer("totp_last_step"),
    // Kayıtta e-posta sahipliği doğrulanana kadar giriş yapılamaz (hesap numaralandırmayı da önler)
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256(token) — token'ın kendisi yalnızca çerezde
    idHash: text("id_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Admin oturumu yalnızca TOTP doğrulanınca true olur
    secondFactorAt: timestamp("second_factor_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  idHash: text("id_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  idHash: text("id_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

export const addresses = pgTable(
  "addresses",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    city: text("city").notNull(),
    district: text("district").notNull(),
    line: text("line").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("addresses_user_idx").on(t.userId)],
);

// ---------- Katalog ----------

export const categories = pgTable(
  "categories",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("categories_slug_idx").on(t.slug)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    details: text("details").notNull().default(""),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    price: integer("price").notNull(),
    // Trendyol'daki satış fiyatı; yalnızca bilgi amaçlı gösterilir
    trendyolPrice: integer("trendyol_price"),
    // Trendyol'dan en son okunan satış fiyatı (karşılaştırma kaldırılsa da saklanır); indirim bundan hesaplanır
    trendyolSalePrice: integer("trendyol_sale_price"),
    // Doluysa site fiyatı = Trendyol satış fiyatı − %indirim (saatlik senkronda yeniden hesaplanır); boşsa fiyat elle
    trendyolDiscount: integer("trendyol_discount"),
    // N11 satış fiyatı (kuruş); boşsa Ayarlar'daki oranla site fiyatından hesaplanır
    n11Price: integer("n11_price"),
    // Ürüne özel pazaryeri özellikleri (ör. topuk tipi); kategori eşlemesindekilerle birleşir, aynı özellikte bu geçerli
    marketplaceAttrs: jsonb("marketplace_attrs").$type<{ n11?: MarketplaceAttr[] }>().notNull().default({}),
    // Trendyol'dan aktarılan ürünün productMainId'si (aynı ürün iki kez aktarılmaz)
    trendyolMainId: text("trendyol_main_id"),
    status: productStatus("status").notNull().default("draft"),
    featured: boolean("featured").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_slug_idx").on(t.slug),
    index("products_status_idx").on(t.status),
    uniqueIndex("products_trendyol_main_id_idx").on(t.trendyolMainId).where(sql`${t.trendyolMainId} is not null`),
    check("products_price_positive", sql`${t.price} > 0`),
    check("products_trendyol_discount_range", sql`${t.trendyolDiscount} between 0 and 90`),
  ],
);

export const productColors = pgTable(
  "product_colors",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    // Trendyol'dan aktarılan rengin kaynağı (içerik kimliği; içerikte birden çok renk varsa "içerik|renk")
    trendyolKey: text("trendyol_key"),
  },
  (t) => [
    index("product_colors_product_idx").on(t.productId),
    uniqueIndex("product_colors_trendyol_key_idx").on(t.productId, t.trendyolKey).where(sql`${t.trendyolKey} is not null`),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: id(),
    colorId: uuid("color_id")
      .notNull()
      .references(() => productColors.id, { onDelete: "cascade" }),
    // Depolama anahtarı, ör. "p/3f2a…" — boyut eki servis sırasında eklenir
    storageKey: text("storage_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_images_color_idx").on(t.colorId)],
);

export const variants = pgTable(
  "variants",
  {
    id: id(),
    colorId: uuid("color_id")
      .notNull()
      .references(() => productColors.id, { onDelete: "cascade" }),
    size: text("size").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    // Mağaza içi üretim barkodu (EAN-13, "29" ile başlar); yalnızca yönetimde görünür. Değeri veritabanı üretir.
    productionBarcode: text("production_barcode")
      .notNull()
      .default(sql`next_production_barcode()`),
    stock: integer("stock").notNull().default(0),
    // Trendyol'dan aktarıldıysa anı: bundan önce verilmiş Trendyol siparişleri aktarılan stokta zaten düşülmüştür
    trendyolImportedAt: timestamp("trendyol_imported_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("variants_production_barcode_idx").on(t.productionBarcode),
    uniqueIndex("variants_sku_idx").on(t.sku),
    // Trendyol eşleşmesi barkodla yapılır; aynı barkod iki numarada olamaz
    uniqueIndex("variants_barcode_idx").on(t.barcode).where(sql`${t.barcode} is not null`),
    uniqueIndex("variants_color_size_idx").on(t.colorId, t.size),
    check("variants_stock_non_negative", sql`${t.stock} >= 0`),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: stockReason("reason").notNull(),
    reference: text("reference"),
    note: text("note"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("stock_movements_variant_idx").on(t.variantId)],
);

// ---------- Sepet ----------

export const carts = pgTable(
  "carts",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    // Misafir sepeti: SHA-256(çerez token'ı)
    guestHash: text("guest_hash"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("carts_user_idx").on(t.userId), uniqueIndex("carts_guest_idx").on(t.guestHash)],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: id(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("cart_items_cart_variant_idx").on(t.cartId, t.variantId),
    check("cart_items_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

// ---------- Siparişler ----------

export type AddressSnapshot = {
  fullName: string;
  phone: string;
  city: string;
  district: string;
  line: string;
};

export const orders = pgTable(
  "orders",
  {
    id: id(),
    number: text("number").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    // Misafirin siparişini görüntülemesi için: SHA-256(erişim token'ı)
    guestAccessHash: text("guest_access_hash"),
    shippingAddress: jsonb("shipping_address").$type<AddressSnapshot>().notNull(),
    subtotal: integer("subtotal").notNull(),
    shippingFee: integer("shipping_fee").notNull(),
    total: integer("total").notNull(),
    status: orderStatus("status").notNull().default("awaiting_payment"),
    // Süresi dolan sipariş geç gelen ödemeyle canlanabilir; yönetici iptali canlanmaz
    cancelReason: cancelReason("cancel_reason"),
    paymentExpiresAt: timestamp("payment_expires_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
    termsAcceptedIp: text("terms_accepted_ip"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_number_idx").on(t.number),
    index("orders_user_idx").on(t.userId),
    index("orders_status_idx").on(t.status),
    index("orders_open_ip_idx").on(t.termsAcceptedIp, t.status),
    index("orders_open_email_idx").on(t.email, t.status),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    productSlug: text("product_slug").notNull(),
    colorName: text("color_name").notNull(),
    size: text("size").notNull(),
    sku: text("sku").notNull(),
    unitPrice: integer("unit_price").notNull(),
    quantity: integer("quantity").notNull(),
    imageKey: text("image_key"),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    // Sağlayıcıya iletilen tek kullanımlık ödeme oturumu kimliği
    token: text("token").notNull(),
    // Sağlayıcının ödeme oturumu kimliği (iyzico Checkout Form token'ı) — mutabakat sorgusu için
    providerSession: text("provider_session"),
    amount: integer("amount").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    raw: jsonb("raw"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("payments_token_idx").on(t.token), index("payments_order_idx").on(t.orderId)],
);

// ---------- Trendyol ortak stok ----------

export type TrendyolLine = { barcode: string; quantity: number; status: string };

// Trendyol sipariş paketleri (yalnızca stok için gereken alanlar; müşteri bilgisi tutulmaz)
export const trendyolPackages = pgTable(
  "trendyol_packages",
  {
    id: text("id").primaryKey(),
    orderNumber: text("order_number").notNull(),
    status: text("status").notNull(),
    lines: jsonb("lines").$type<TrendyolLine[]>().notNull(),
    // Senkron açılmadan önce verilmiş siparişler stoktan düşülmez (stok zaten buna göre girilmiştir)
    orderDate: timestamp("order_date", { withTimezone: true }),
    lastModifiedAt: timestamp("last_modified_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [index("trendyol_packages_order_idx").on(t.orderNumber)],
);

// Bir Trendyol siparişinin bir barkod için stoktan düştüğü adet. Paketler değiştikçe hedefe yaklaştırılır.
export const trendyolOrderStock = pgTable(
  "trendyol_order_stock",
  {
    orderNumber: text("order_number").notNull(),
    barcode: text("barcode").notNull(),
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    // Paketlere göre olması gereken adet
    quantity: integer("quantity").notNull().default(0),
    // Gerçekten stoktan düşülen adet
    deducted: integer("deducted").notNull().default(0),
    // Stok yetmediği için düşülemeyen adet (iki kanalda aynı çift satıldı)
    shortfall: integer("shortfall").notNull().default(0),
    // Muhasebe: eşleşme anındaki alış fiyatı ve üretici (yalnızca yönetim)
    unitCost: integer("unit_cost"),
    manufacturerId: uuid("manufacturer_id").references(() => manufacturers.id, { onDelete: "restrict" }),
    costFixedAt: timestamp("cost_fixed_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orderNumber, t.barcode] }), index("trendyol_order_stock_variant_idx").on(t.variantId)],
);

export const trendyolPushStatus = pgEnum("trendyol_push_status", ["pending", "ok", "failed"]);

// Trendyol'a bir barkod için en son gönderilen stok. Trendyol'da kimlik barkoddur: numara silinse ya da
// barkodu değişse de kayıt kalır ve eski barkoda 0 gönderilir.
export const trendyolStockPush = pgTable("trendyol_stock_push", {
  barcode: text("barcode").primaryKey(),
  variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
  quantity: integer("quantity").notNull(),
  batchRequestId: text("batch_request_id"),
  status: trendyolPushStatus("status").notNull(),
  error: text("error"),
  // Aynı adet art arda reddedildikçe yeniden deneme aralığı uzar (ör. Trendyol'da olmayan barkod)
  attempts: integer("attempts").notNull().default(0),
  pushedAt: timestamp("pushed_at", { withTimezone: true }).notNull(),
});

// ---------- Üreticiler ve muhasebe (yalnızca yönetim) ----------
// Vitrin sorguları bu tablolara hiç dokunmaz: alış fiyatı ve üretici müşteriye sızamaz.

export const manufacturers = pgTable(
  "manufacturers",
  {
    id: id(),
    name: text("name").notNull(),
    contactName: text("contact_name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    taxOffice: text("tax_office").notNull().default(""),
    taxNumber: text("tax_number").notNull().default(""),
    address: text("address").notNull().default(""),
    iban: text("iban").notNull().default(""),
    note: text("note").notNull().default(""),
    // Sisteme geçmeden önceki borç (pozitif: biz borçluyuz)
    openingBalance: integer("opening_balance").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("manufacturers_name_idx").on(sql`lower(${t.name})`)],
);

export const productSupply = pgTable(
  "product_supply",
  {
    productId: uuid("product_id")
      .primaryKey()
      .references(() => products.id, { onDelete: "cascade" }),
    manufacturerId: uuid("manufacturer_id").references(() => manufacturers.id, { onDelete: "restrict" }),
    // Birim alış fiyatı (kuruş)
    purchasePrice: integer("purchase_price"),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("product_supply_manufacturer_idx").on(t.manufacturerId),
    check("product_supply_price_non_negative", sql`${t.purchasePrice} >= 0`),
  ],
);

// Satış anındaki maliyet ve üretici (ürünün alış fiyatı sonradan değişse de geçmiş kâr değişmez)
export const orderItemCosts = pgTable(
  "order_item_costs",
  {
    orderItemId: uuid("order_item_id")
      .primaryKey()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    manufacturerId: uuid("manufacturer_id").references(() => manufacturers.id, { onDelete: "restrict" }),
    unitCost: integer("unit_cost"),
  },
  (t) => [index("order_item_costs_manufacturer_idx").on(t.manufacturerId)],
);

export const purchaseKind = pgEnum("purchase_kind", ["purchase", "return"]);

// Mal alım fişi ya da üreticiye iade fişi. Silinmez; yanlışlık ters fişle düzeltilir.
export const purchases = pgTable(
  "purchases",
  {
    id: id(),
    number: integer("number").generatedAlwaysAsIdentity(),
    kind: purchaseKind("kind").notNull(),
    manufacturerId: uuid("manufacturer_id")
      .notNull()
      .references(() => manufacturers.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    note: text("note").notNull().default(""),
    total: integer("total").notNull(),
    // Formun tek kullanımlık kimliği: aynı gönderim iki kez fiş oluşturmaz
    requestId: uuid("request_id"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("purchases_number_idx").on(t.number),
    uniqueIndex("purchases_request_idx").on(t.requestId),
    index("purchases_manufacturer_idx").on(t.manufacturerId, t.date),
    check("purchases_total_non_negative", sql`${t.total} >= 0`),
  ],
);

export const purchaseItems = pgTable(
  "purchase_items",
  {
    id: id(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    colorName: text("color_name").notNull(),
    size: text("size").notNull(),
    productionBarcode: text("production_barcode").notNull(),
    quantity: integer("quantity").notNull(),
    unitCost: integer("unit_cost").notNull(),
  },
  (t) => [
    index("purchase_items_purchase_idx").on(t.purchaseId),
    index("purchase_items_variant_idx").on(t.variantId),
    index("purchase_items_product_idx").on(t.productId),
    check("purchase_items_quantity_positive", sql`${t.quantity} > 0`),
    check("purchase_items_cost_non_negative", sql`${t.unitCost} >= 0`),
  ],
);

export const ledgerKind = pgEnum("ledger_kind", ["income", "expense"]);

// Elle girilen gelir ve giderler. Site satışları siparişlerden hesaplanır, buraya yazılmaz.
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    kind: ledgerKind("kind").notNull(),
    category: text("category").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    amount: integer("amount").notNull(),
    method: text("method").notNull(),
    description: text("description").notNull().default(""),
    // Yalnızca "Üretici ödemesi" giderinde dolu; üreticinin borcundan düşer
    manufacturerId: uuid("manufacturer_id").references(() => manufacturers.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_entries_date_idx").on(t.date),
    index("ledger_entries_manufacturer_idx").on(t.manufacturerId),
    check("ledger_entries_amount_positive", sql`${t.amount} > 0`),
  ],
);

// ---------- Yönetim ----------

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    data: jsonb("data"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

export const settings = pgTable(
  "settings",
  {
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key] })],
);

// ---------- Bildirimler (yönetici telefonları, Web Push) ----------

export const notificationKind = pgEnum("notification_kind", ["order_new", "refund_needed", "stock_low", "stock_out", "test", "integration"]);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    label: text("label").notNull(),
    createdAt: createdAt(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId)],
);

// Bildirim kutusu: olay kendi işlemiyle birlikte yazılır, sonra gönderilir. Kaynak: site, trendyol (ileride n11, hepsiburada)
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    kind: notificationKind("kind").notNull(),
    source: text("source").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    data: jsonb("data"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    // Gönderen bu kaydı aldı (kısa işlemle); gönderim işlem dışında. Süresi geçen alım yeniden alınabilir
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_idx").on(t.dedupeKey),
    index("notifications_pending_idx").on(t.createdAt).where(sql`${t.sentAt} is null`),
  ],
);

// ---------- Pazaryerleri (N11; ileride Hepsiburada) — kanal bazlı ----------
// Trendyol'un kendi tabloları ayrı kalır. Müşteri kişisel verisi saklanmaz.

export type MarketplaceLine = { stockCode: string; quantity: number; lineId: string; status: string };
export type MarketplaceAttr = { id: number; name: string; valueId: number | null; customValue: string | null };

// Pazaryerinin en alt düzey kategorileri (eşleştirmede aranır)
export const marketplaceCategories = pgTable(
  "marketplace_categories",
  {
    channel: text("channel").notNull(),
    externalId: bigint("external_id", { mode: "number" }).notNull(),
    path: text("path").notNull(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.externalId] })],
);

// Site kategorisi → pazaryeri kategorisi ve kategoriye sabit özellikler (ör. Cinsiyet)
export const marketplaceCategoryMap = pgTable(
  "marketplace_category_map",
  {
    channel: text("channel").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    externalCategoryId: bigint("external_category_id", { mode: "number" }).notNull(),
    externalPath: text("external_path").notNull(),
    attributes: jsonb("attributes").$type<MarketplaceAttr[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.categoryId] })],
);

export const marketplaceListingStatus = pgEnum("marketplace_listing_status", ["pending", "active", "failed"]);

// Bir numaranın pazaryerindeki karşılığı (stockCode = variants.sku). Numara silinse de kayıt kalır
// (variant_id boşalır): pazaryerine 0 gönderilir, eski stokla satışta kalmaz.
export const marketplaceListings = pgTable(
  "marketplace_listings",
  {
    channel: text("channel").notNull(),
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    stockCode: text("stock_code").notNull(),
    productId: uuid("product_id").notNull(),
    status: marketplaceListingStatus("status").notNull(),
    taskId: text("task_id"),
    error: text("error"),
    pushedQuantity: integer("pushed_quantity"),
    pushedPrice: integer("pushed_price"),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    pushTaskId: text("push_task_id"),
    pushError: text("push_error"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.channel, t.stockCode] }),
    uniqueIndex("marketplace_listings_variant_idx").on(t.channel, t.variantId).where(sql`${t.variantId} is not null`),
  ],
);

// Sonucu henüz okunmamış pazaryeri görevleri (ürün yükleme, fiyat/stok)
export const marketplaceTasks = pgTable(
  "marketplace_tasks",
  {
    channel: text("channel").notNull(),
    taskId: text("task_id").notNull(),
    kind: text("kind").notNull(),
    done: boolean("done").notNull().default(false),
    createdAt: createdAt(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.channel, t.taskId] })],
);

export const marketplacePackages = pgTable(
  "marketplace_packages",
  {
    channel: text("channel").notNull(),
    id: text("id").notNull(),
    orderNumber: text("order_number").notNull(),
    status: text("status").notNull(),
    lines: jsonb("lines").$type<MarketplaceLine[]>().notNull(),
    orderDate: timestamp("order_date", { withTimezone: true }),
    lastModifiedAt: timestamp("last_modified_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.id] }), index("marketplace_packages_order_idx").on(t.channel, t.orderNumber)],
);

// Bir pazaryeri siparişinin bir stok kodu için stoktan düştüğü adet (Trendyol'daki trendyol_order_stock gibi)
export const marketplaceOrderStock = pgTable(
  "marketplace_order_stock",
  {
    channel: text("channel").notNull(),
    orderNumber: text("order_number").notNull(),
    stockCode: text("stock_code").notNull(),
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    quantity: integer("quantity").notNull().default(0),
    deducted: integer("deducted").notNull().default(0),
    shortfall: integer("shortfall").notNull().default(0),
    unitCost: integer("unit_cost"),
    manufacturerId: uuid("manufacturer_id").references(() => manufacturers.id, { onDelete: "restrict" }),
    costFixedAt: timestamp("cost_fixed_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.channel, t.orderNumber, t.stockCode] }),
    index("marketplace_order_stock_variant_idx").on(t.variantId),
  ],
);

export const marketplaceSyncState = pgTable("marketplace_sync_state", {
  channel: text("channel").primaryKey(),
  state: jsonb("state").notNull(),
});

// ---------- Entegrasyon anahtarları ----------

// Panelden girilen anahtarlar (AES-256-GCM, ana anahtar SECRETS_KEY). Değer hiçbir zaman düz metin saklanmaz.
export const integrationSecrets = pgTable("integration_secrets", {
  name: text("name").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  last4: text("last4").notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

// Entegrasyonların son kullanma tarihi ve son sağlık denemesi
export const integrations = pgTable("integrations", {
  id: text("id").primaryKey(),
  expiresAt: date("expires_at", { mode: "string" }),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  ok: boolean("ok"),
  message: text("message"),
});
