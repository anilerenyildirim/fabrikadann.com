import { sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

export async function resetDb() {
  await db.execute(sql`
    TRUNCATE users, sessions, password_reset_tokens, email_verification_tokens, rate_limits, addresses, categories, products,
      product_colors, product_images, variants, stock_movements, carts, cart_items, orders,
      order_items, payments, audit_log, settings
    RESTART IDENTITY CASCADE
  `);
}

let seq = 0;

type MakeProductInput = {
  name?: string;
  price?: number;
  status?: "draft" | "active" | "archived";
  categoryId?: string | null;
  colors?: { name: string; sizes: { size: string; stock: number }[] }[];
  sizes?: { size: string; stock: number }[];
};

export async function makeProduct(input: MakeProductInput = {}) {
  const n = ++seq;
  const [product] = await db
    .insert(schema.products)
    .values({
      name: input.name ?? `Test Ayakkabı ${n}`,
      slug: `test-ayakkabi-${n}`,
      price: input.price ?? 100000,
      status: input.status ?? "active",
      categoryId: input.categoryId ?? null,
    })
    .returning();
  const colors = input.colors ?? [{ name: "Siyah", sizes: input.sizes ?? [{ size: "40", stock: 5 }] }];
  const variants: (typeof schema.variants.$inferSelect)[] = [];
  for (const [i, c] of colors.entries()) {
    const [color] = await db
      .insert(schema.productColors)
      .values({ productId: product!.id, name: c.name, position: i })
      .returning();
    for (const s of c.sizes) {
      const [v] = await db
        .insert(schema.variants)
        .values({ colorId: color!.id, size: s.size, sku: `SKU-${n}-${i}-${s.size}`, stock: s.stock })
        .returning();
      variants.push(v!);
    }
  }
  return { product: product!, variants };
}

export async function makeUser(input: { email?: string; role?: "customer" | "admin" } = {}) {
  const n = ++seq;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: input.email ?? `kullanici${n}@ornek.com`,
      passwordHash: "x",
      firstName: "Test",
      lastName: `Kullanıcı ${n}`,
      role: input.role ?? "customer",
      emailVerifiedAt: new Date(),
    })
    .returning();
  return user!;
}
