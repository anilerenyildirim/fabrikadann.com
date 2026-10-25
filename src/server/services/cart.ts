import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@/server/db";
import { sha256 } from "@/server/auth/crypto";
import { getSettings, type Settings } from "./settings";
import type { ImageRef } from "./catalog";

const { carts, cartItems, variants, productColors, products, productImages } = schema;

export const MAX_QTY_PER_LINE = 5;
export const MAX_LINES = 30;

export type CartOwner = { userId: string } | { guestToken: string };

export type CartLine = {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  colorName: string;
  size: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  image: ImageRef | null;
  /** Satın alınabilir mi; değilse neden */
  problem: null | "unavailable" | "out_of_stock" | "insufficient_stock";
  maxQuantity: number;
};

export type Cart = {
  id: string | null;
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
  shippingFee: number;
  total: number;
  freeShippingThreshold: number;
  hasProblems: boolean;
};

export type CartResult = { ok: true } | { ok: false; error: string };

function ownerWhere(owner: CartOwner) {
  return "userId" in owner ? eq(carts.userId, owner.userId) : eq(carts.guestHash, sha256(owner.guestToken));
}

async function findCartId(owner: CartOwner, tx: DbOrTx = db): Promise<string | null> {
  const [row] = await tx.select({ id: carts.id }).from(carts).where(ownerWhere(owner)).limit(1);
  return row?.id ?? null;
}

async function ensureCartId(owner: CartOwner, tx: DbOrTx = db): Promise<string> {
  const values = "userId" in owner ? { userId: owner.userId } : { guestHash: sha256(owner.guestToken) };
  const target = "userId" in owner ? carts.userId : carts.guestHash;
  // Eşzamanlı ilk eklemelerde tek sepet oluşsun
  const [row] = await tx
    .insert(carts)
    .values(values)
    .onConflictDoUpdate({ target, set: { updatedAt: new Date() } })
    .returning({ id: carts.id });
  return row!.id;
}

export function computeShipping(subtotal: number, s: Pick<Settings, "shippingFee" | "freeShippingThreshold">) {
  if (subtotal === 0) return 0;
  return subtotal >= s.freeShippingThreshold ? 0 : s.shippingFee;
}

export async function loadCartLines(cartId: string, tx: DbOrTx = db): Promise<CartLine[]> {
  const rows = await tx
    .select({
      id: cartItems.id,
      variantId: variants.id,
      quantity: cartItems.quantity,
      size: variants.size,
      sku: variants.sku,
      stock: variants.stock,
      colorId: productColors.id,
      colorName: productColors.name,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
      price: products.price,
      status: products.status,
    })
    .from(cartItems)
    .innerJoin(variants, eq(variants.id, cartItems.variantId))
    .innerJoin(productColors, eq(productColors.id, variants.colorId))
    .innerJoin(products, eq(products.id, productColors.productId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(cartItems.createdAt), asc(cartItems.id));

  const colorIds = [...new Set(rows.map((r) => r.colorId))];
  const images = colorIds.length
    ? await tx
        .selectDistinctOn([productImages.colorId], {
          colorId: productImages.colorId,
          key: productImages.storageKey,
          width: productImages.width,
          height: productImages.height,
          alt: productImages.alt,
        })
        .from(productImages)
        .where(inArray(productImages.colorId, colorIds))
        .orderBy(productImages.colorId, asc(productImages.position))
    : [];

  return rows.map((r) => {
    const img = images.find((i) => i.colorId === r.colorId);
    const problem: CartLine["problem"] =
      r.status !== "active" ? "unavailable" : r.stock <= 0 ? "out_of_stock" : r.stock < r.quantity ? "insufficient_stock" : null;
    return {
      id: r.id,
      variantId: r.variantId,
      productId: r.productId,
      productName: r.productName,
      productSlug: r.productSlug,
      colorName: r.colorName,
      size: r.size,
      sku: r.sku,
      unitPrice: r.price,
      quantity: r.quantity,
      lineTotal: r.price * r.quantity,
      image: img ? { key: img.key, width: img.width, height: img.height, alt: img.alt || r.productName } : null,
      problem,
      maxQuantity: Math.max(0, Math.min(MAX_QTY_PER_LINE, r.stock)),
    };
  });
}

export async function getCart(owner: CartOwner | null): Promise<Cart> {
  const settings = await getSettings();
  const cartId = owner ? await findCartId(owner) : null;
  const lines = cartId ? await loadCartLines(cartId) : [];
  const valid = lines.filter((l) => l.problem === null);
  const subtotal = valid.reduce((sum, l) => sum + l.lineTotal, 0);
  const shippingFee = computeShipping(subtotal, settings);
  return {
    id: cartId,
    lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal,
    shippingFee,
    total: subtotal + shippingFee,
    freeShippingThreshold: settings.freeShippingThreshold,
    hasProblems: lines.some((l) => l.problem !== null),
  };
}

async function purchasableVariant(variantId: string, tx: DbOrTx = db) {
  const [row] = await tx
    .select({ id: variants.id, stock: variants.stock })
    .from(variants)
    .innerJoin(productColors, eq(productColors.id, variants.colorId))
    .innerJoin(products, eq(products.id, productColors.productId))
    .where(and(eq(variants.id, variantId), eq(products.status, "active")))
    .limit(1);
  return row ?? null;
}

export async function addToCart(owner: CartOwner, variantId: string, quantity = 1): Promise<CartResult> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_LINE) {
    return { ok: false, error: "Geçersiz adet." };
  }
  return db.transaction(async (tx) => {
    const variant = await purchasableVariant(variantId, tx);
    if (!variant) return { ok: false, error: "Bu ürün artık satışta değil." };
    if (variant.stock <= 0) return { ok: false, error: "Bu numara tükendi." };

    const cartId = await ensureCartId(owner, tx);
    const [existing] = await tx
      .select({ quantity: cartItems.quantity })
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)))
      .for("update");
    const next = (existing?.quantity ?? 0) + quantity;
    if (next > MAX_QTY_PER_LINE) return { ok: false, error: `Bir üründen en fazla ${MAX_QTY_PER_LINE} adet alınabilir.` };
    if (next > variant.stock) return { ok: false, error: "Bu numaradan stokta yeterli ürün yok." };

    if (!existing) {
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(cartItems)
        .where(eq(cartItems.cartId, cartId));
      if ((count?.n ?? 0) >= MAX_LINES) return { ok: false, error: "Sepetiniz dolu." };
    }

    await tx
      .insert(cartItems)
      .values({ cartId, variantId, quantity: next })
      .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.variantId], set: { quantity: next } });
    return { ok: true };
  });
}

/** Satırın adetini değiştirir; 0 satırı siler. Satır başka bir sepete aitse hiçbir şey yapmaz. */
export async function setQuantity(owner: CartOwner, lineId: string, quantity: number): Promise<CartResult> {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QTY_PER_LINE) {
    return { ok: false, error: "Geçersiz adet." };
  }
  const cartId = await findCartId(owner);
  if (!cartId) return { ok: false, error: "Sepet bulunamadı." };
  if (quantity === 0) return removeLine(owner, lineId);

  const [line] = await db
    .select({ variantId: cartItems.variantId })
    .from(cartItems)
    .where(and(eq(cartItems.id, lineId), eq(cartItems.cartId, cartId)))
    .limit(1);
  if (!line) return { ok: false, error: "Ürün sepette bulunamadı." };
  const variant = await purchasableVariant(line.variantId);
  if (!variant) return { ok: false, error: "Bu ürün artık satışta değil." };
  if (quantity > variant.stock) return { ok: false, error: "Bu numaradan stokta yeterli ürün yok." };

  await db
    .update(cartItems)
    .set({ quantity })
    .where(and(eq(cartItems.id, lineId), eq(cartItems.cartId, cartId)));
  return { ok: true };
}

export async function removeLine(owner: CartOwner, lineId: string): Promise<CartResult> {
  const cartId = await findCartId(owner);
  if (!cartId) return { ok: false, error: "Sepet bulunamadı." };
  await db.delete(cartItems).where(and(eq(cartItems.id, lineId), eq(cartItems.cartId, cartId)));
  return { ok: true };
}

export async function clearCart(cartId: string, tx: DbOrTx = db): Promise<void> {
  await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));
}

/** Girişte misafir sepetini kullanıcının sepetine taşır; adetler toplanır ve sınırlanır. */
export async function mergeGuestCart(guestToken: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const guestId = await findCartId({ guestToken }, tx);
    if (!guestId) return;
    const guestItems = await tx.select().from(cartItems).where(eq(cartItems.cartId, guestId));
    if (guestItems.length > 0) {
      const userCartId = await ensureCartId({ userId }, tx);
      const existing = await tx.select({ variantId: cartItems.variantId }).from(cartItems).where(eq(cartItems.cartId, userCartId));
      const known = new Set(existing.map((e) => e.variantId));
      let lines = known.size;
      for (const item of guestItems) {
        // Sepet satır sınırı birleştirmede de geçerli
        if (!known.has(item.variantId)) {
          if (lines >= MAX_LINES) continue;
          lines++;
        }
        await tx
          .insert(cartItems)
          .values({ cartId: userCartId, variantId: item.variantId, quantity: Math.min(item.quantity, MAX_QTY_PER_LINE) })
          .onConflictDoUpdate({
            target: [cartItems.cartId, cartItems.variantId],
            set: { quantity: sql`least(${cartItems.quantity} + ${item.quantity}, ${MAX_QTY_PER_LINE})` },
          });
      }
    }
    await tx.delete(carts).where(eq(carts.id, guestId));
  });
}
