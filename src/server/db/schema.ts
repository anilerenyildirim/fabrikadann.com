import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
export const stockReason = pgEnum("stock_reason", ["order", "cancel", "manual", "trendyol", "initial"]);

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
    status: productStatus("status").notNull().default("draft"),
    featured: boolean("featured").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_slug_idx").on(t.slug),
    index("products_status_idx").on(t.status),
    check("products_price_positive", sql`${t.price} > 0`),
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
  },
  (t) => [index("product_colors_product_idx").on(t.productId)],
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
    stock: integer("stock").notNull().default(0),
  },
  (t) => [
    uniqueIndex("variants_sku_idx").on(t.sku),
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
    amount: integer("amount").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    raw: jsonb("raw"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("payments_token_idx").on(t.token), index("payments_order_idx").on(t.orderId)],
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
