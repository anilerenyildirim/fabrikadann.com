import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { applySuggestion } from "@/server/services/admin/ai-assistant";
import { AdminError, type AdminContext } from "@/server/services/admin/context";
import { makeProduct, makeUser, resetDb } from "../helpers/db";

let ctx: AdminContext;
beforeEach(async () => {
  await resetDb();
  ctx = { actorId: (await makeUser({ role: "admin" })).id };
});

const productRow = async (id: string) => (await db.select().from(schema.products).where(eq(schema.products.id, id)))[0]!;

test("yalnız seçilen alanlar değişir; renk adı ve N11 özellikleri uygulanır", async () => {
  const { product } = await makeProduct({ name: "Eski ad" });
  const [color] = await db.select().from(schema.productColors).where(eq(schema.productColors.productId, product.id));
  const [cat] = await db.insert(schema.categories).values({ name: "Bot", slug: "bot" }).returning();
  await applySuggestion(ctx, product.id, {
    description: "Yeni açıklama",
    categoryId: cat!.id,
    colors: [{ colorId: color!.id, name: "Siyah" }],
    n11Attributes: [{ id: 7794, name: "Topuk Tipi", valueId: null, customValue: "Blok" }],
  });
  const p = await productRow(product.id);
  expect(p.name).toBe("Eski ad");
  expect(p.description).toBe("Yeni açıklama");
  expect(p.categoryId).toBe(cat!.id);
  expect(p.marketplaceAttrs).toEqual({ n11: [{ id: 7794, name: "Topuk Tipi", valueId: null, customValue: "Blok" }] });
  const [c] = await db.select().from(schema.productColors).where(eq(schema.productColors.id, color!.id));
  expect(c!.name).toBe("Siyah");
  const [log] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "ai.suggestion_applied"));
  expect(log!.target).toBe(product.id);
});

test("başka ürünün rengi reddedilir", async () => {
  const a = await makeProduct();
  const b = await makeProduct();
  const [other] = await db.select().from(schema.productColors).where(eq(schema.productColors.productId, b.product.id));
  await expect(applySuggestion(ctx, a.product.id, { colors: [{ colorId: other!.id, name: "Mavi" }] })).rejects.toBeInstanceOf(AdminError);
});

test("aynı üründe iki renge aynı ad verilemez", async () => {
  const { product } = await makeProduct({ colors: [{ name: "A", sizes: [{ size: "38", stock: 1 }] }, { name: "B", sizes: [{ size: "38", stock: 1 }] }] });
  const colors = await db.select().from(schema.productColors).where(eq(schema.productColors.productId, product.id));
  await expect(
    applySuggestion(ctx, product.id, { colors: colors.map((c) => ({ colorId: c.id, name: "Siyah" })) }),
  ).rejects.toBeInstanceOf(AdminError);
});
