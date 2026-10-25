import { and, asc, eq, exists, inArray, like, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type DbOrTx, type Tx } from "@/server/db";
import { slugify } from "@/lib/slug";
import { deleteProductImage, ImageError, storeProductImage } from "@/server/storage/images";
import { audit } from "../audit";
import { compareSizes, foldForSearch, type ImageRef } from "../catalog";
import { setStock } from "../stock";
import { AdminError, assertAdmin, isUniqueViolation, reorder, type AdminContext } from "./context";

const { products, productColors, productImages, variants, categories, orderItems } = schema;

export type ProductStatus = (typeof schema.productStatus.enumValues)[number];

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Taslak",
  active: "Yayında",
  archived: "Arşivde",
};

export const MAX_PRICE_KURUS = 100_000_000; // 1.000.000 TL
export const MAX_COLORS_PER_PRODUCT = 20;
export const MAX_IMAGES_PER_COLOR = 20;
export const MAX_STOCK = 100_000;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------- Şemalar ----------

const priceSchema = z
  .number({ error: "Fiyatı 1.299,90 biçiminde yazın." })
  .int("Fiyatı 1.299,90 biçiminde yazın.")
  .min(1, "Fiyat 0'dan büyük olmalı.")
  .max(MAX_PRICE_KURUS, "Fiyat 1.000.000 TL'den küçük olmalı.");

export const productInputSchema = z.object({
  name: z.string().trim().min(1, "Ürün adını yazın.").max(120, "Ürün adı en fazla 120 karakter olabilir."),
  /** Boşsa addan üretilir */
  slug: z.string().trim().max(80, "Adres en fazla 80 karakter olabilir.").default(""),
  description: z.string().trim().max(5000, "Açıklama en fazla 5000 karakter olabilir.").default(""),
  details: z.string().trim().max(5000, "Malzeme ve bakım en fazla 5000 karakter olabilir.").default(""),
  categoryId: z.uuid("Kategori seçin.").nullable().default(null),
  price: priceSchema,
  trendyolPrice: priceSchema.nullable().default(null),
  status: z.enum(["draft", "active", "archived"], { error: "Durum seçin." }).default("draft"),
  featured: z.boolean().default(false),
});

export type ProductInput = z.input<typeof productInputSchema>;

const idSchema = z.uuid();
const colorNameSchema = z
  .string()
  .trim()
  .min(1, "Renk adını yazın.")
  .max(40, "Renk adı en fazla 40 karakter olabilir.");
const altSchema = z.string().trim().max(200, "Alt metin en fazla 200 karakter olabilir.");
const directionSchema = z.enum(["up", "down"]);
const skuSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(
    z
      .string()
      .min(1, "SKU boş olamaz.")
      .max(64, "SKU en fazla 64 karakter olabilir.")
      .regex(/^[A-Z0-9][A-Z0-9._-]*$/, "SKU yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir."),
  );
const barcodeSchema = z
  .string()
  .trim()
  .max(32, "Barkod en fazla 32 karakter olabilir.")
  .regex(/^[0-9A-Za-z-]*$/, "Barkod yalnızca harf, rakam ve tire içerebilir.");
const stockSchema = z
  .number({ error: "Stok için 0 ya da daha büyük bir tam sayı yazın." })
  .int("Stok için tam sayı yazın.")
  .min(0, "Stok 0'dan küçük olamaz.")
  .max(MAX_STOCK, "Stok en fazla 100.000 olabilir.");
const noteSchema = z
  .string()
  .trim()
  .min(3, "Düzeltmenin sebebini yazın (ör. sayım farkı).")
  .max(200, "Not en fazla 200 karakter olabilir.");

function parseOrThrow<T>(schemaDef: z.ZodType<T>, value: unknown, field?: string): T {
  const r = schemaDef.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new AdminError(issue?.message ?? "Geçersiz değer.", field ?? (issue?.path.join(".") || undefined));
  }
  return r.data;
}

const parseId = (value: unknown, what = "Kayıt") => {
  const r = idSchema.safeParse(value);
  if (!r.success) throw new AdminError(`${what} bulunamadı.`);
  return r.data;
};

// ---------- Slug ----------

/** Adres (slug) için temel biçim: Türkçe harfler sadeleşir, boşsa yedek kullanılır. */
export function slugBase(input: string, fallback = "urun"): string {
  return slugify(input).slice(0, 80).replace(/-+$/, "") || fallback;
}

/** base, base-2, base-3 … içinden boş olan ilkini döner. */
async function freeSlug(
  kind: "product" | "category",
  base: string,
  excludeId: string | null,
  tx: DbOrTx,
): Promise<string> {
  // slug yalnızca [a-z0-9-] içerdiği için LIKE kaçışı gerekmez
  const t = kind === "product" ? { slug: products.slug, id: products.id } : { slug: categories.slug, id: categories.id };
  const clash = or(eq(t.slug, base), like(t.slug, `${base}-%`));
  const where = excludeId ? and(clash, ne(t.id, excludeId)) : clash;
  const rows =
    kind === "product"
      ? await tx.select({ slug: products.slug }).from(products).where(where)
      : await tx.select({ slug: categories.slug }).from(categories).where(where);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function uniqueProductSlug(name: string, excludeId: string | null = null, tx: DbOrTx = db) {
  return freeSlug("product", slugBase(name), excludeId, tx);
}

// ---------- Ürün listesi ve detayı ----------

export type AdminProductRow = {
  id: string;
  name: string;
  slug: string;
  price: number;
  status: ProductStatus;
  featured: boolean;
  categoryName: string | null;
  colorCount: number;
  variantCount: number;
  totalStock: number;
  image: ImageRef | null;
};

const foldSql = (col: SQL | typeof products.name) =>
  sql`lower(translate(${col}, 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc'))`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listAdminProducts(
  input: { q?: string; status?: ProductStatus | "all"; categoryId?: string } = {},
): Promise<AdminProductRow[]> {
  const where: SQL[] = [];
  if (input.status && input.status !== "all") where.push(eq(products.status, input.status));
  if (input.categoryId && idSchema.safeParse(input.categoryId).success) where.push(eq(products.categoryId, input.categoryId));
  const q = input.q?.trim().slice(0, 80);
  if (q) {
    const pattern = `%${escapeLike(foldForSearch(q))}%`;
    const skuPattern = `%${escapeLike(q.toUpperCase())}%`;
    where.push(
      or(
        sql`${foldSql(products.name)} LIKE ${pattern}`,
        like(products.slug, pattern),
        exists(
          db
            .select({ one: sql`1` })
            .from(variants)
            .innerJoin(productColors, eq(productColors.id, variants.colorId))
            .where(and(eq(productColors.productId, products.id), like(variants.sku, skuPattern))),
        ),
      )!,
    );
  }
  const rows = await db.query.products.findMany({
    where: where.length ? and(...where) : undefined,
    orderBy: (p, { desc }) => [desc(p.updatedAt)],
    limit: 500,
    with: {
      category: { columns: { name: true } },
      colors: {
        orderBy: [asc(productColors.position), asc(productColors.id)],
        with: {
          images: { orderBy: [asc(productImages.position), asc(productImages.id)], limit: 1 },
          variants: { columns: { stock: true } },
        },
      },
    },
  });
  return rows.map((p) => {
    const img = p.colors.find((c) => c.images.length > 0)?.images[0];
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: p.price,
      status: p.status,
      featured: p.featured,
      categoryName: p.category?.name ?? null,
      colorCount: p.colors.length,
      variantCount: p.colors.reduce((n, c) => n + c.variants.length, 0),
      totalStock: p.colors.reduce((n, c) => n + c.variants.reduce((m, v) => m + v.stock, 0), 0),
      image: img ? { key: img.storageKey, width: img.width, height: img.height, alt: img.alt || p.name } : null,
    };
  });
}

export async function getAdminProduct(id: string) {
  if (!idSchema.safeParse(id).success) return null;
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: {
      category: true,
      colors: {
        orderBy: [asc(productColors.position), asc(productColors.id)],
        with: {
          images: { orderBy: [asc(productImages.position), asc(productImages.id)] },
          variants: true,
        },
      },
    },
  });
  if (!product) return null;
  return {
    ...product,
    colors: product.colors.map((c) => ({ ...c, variants: [...c.variants].sort((a, b) => compareSizes(a.size, b.size)) })),
  };
}

export type AdminProduct = NonNullable<Awaited<ReturnType<typeof getAdminProduct>>>;

/** Ürün yayına alınamıyorsa sebebi, alınabiliyorsa null. */
async function mediaCounts(productId: string, tx: DbOrTx): Promise<{ images: number; sizes: number }> {
  const result = await tx.execute<{ images: number; sizes: number }>(sql`
    select
      (select count(*)::int from product_images i join product_colors c on c.id = i.color_id where c.product_id = ${productId}) as images,
      (select count(*)::int from variants v join product_colors c on c.id = v.color_id where c.product_id = ${productId}) as sizes
  `);
  return { images: Number(result.rows[0]?.images ?? 0), sizes: Number(result.rows[0]?.sizes ?? 0) };
}

export async function publishProblem(productId: string, tx: DbOrTx = db): Promise<string | null> {
  const { images, sizes } = await mediaCounts(productId, tx);
  if (images === 0 && sizes === 0) return "Yayına almak için önce bir renk ekleyip en az bir görsel ve bir numara girin.";
  if (images === 0) return "Yayına almak için en az bir görsel yükleyin.";
  if (sizes === 0) return "Yayına almak için en az bir numara ekleyin.";
  return null;
}

async function assertCategory(categoryId: string | null, tx: DbOrTx) {
  if (!categoryId) return;
  const [row] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId));
  if (!row) throw new AdminError("Seçilen kategori bulunamadı. Listeden yeniden seçin.", "categoryId");
}

function checkTrendyolPrice(price: number, trendyolPrice: number | null) {
  // Trendyol fiyatı bilgi amaçlı; sitede daha düşük olmalı ki karşılaştırma anlamlı olsun
  if (trendyolPrice !== null && trendyolPrice <= price) {
    throw new AdminError(
      "Trendyol fiyatı site fiyatından yüksek olmalı; değilse alanı boş bırakın (vitrinde karşılaştırma gösterilmez).",
      "trendyolPrice",
    );
  }
}

// ---------- Ürün oluşturma / düzenleme ----------

export async function createProduct(raw: ProductInput, ctx: AdminContext): Promise<{ id: string; slug: string }> {
  await assertAdmin(ctx);
  const input = parseOrThrow(productInputSchema, raw);
  if (input.status === "active") {
    throw new AdminError("Yeni ürün taslak olarak oluşturulur; görsel ve numara ekledikten sonra yayına alın.", "status");
  }
  checkTrendyolPrice(input.price, input.trendyolPrice);
  await assertCategory(input.categoryId, db);
  const base = slugBase(input.slug || input.name);

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await freeSlug("product", base, null, db);
    try {
      const [row] = await db
        .insert(products)
        .values({
          name: input.name,
          slug,
          description: input.description,
          details: input.details,
          categoryId: input.categoryId,
          price: input.price,
          trendyolPrice: input.trendyolPrice,
          status: input.status,
          featured: input.featured,
        })
        .returning({ id: products.id, slug: products.slug });
      await audit({
        action: "product.create",
        actorId: ctx.actorId,
        target: row!.id,
        data: { name: input.name, slug, price: input.price },
        ip: ctx.ip,
      });
      return row!;
    } catch (e) {
      // Aynı anda aynı adla iki ürün: bir sonraki boş adresi dene
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new AdminError("Ürün adresi üretilemedi; adres alanına farklı bir değer yazın.", "slug");
}

export async function updateProduct(id: string, raw: ProductInput, ctx: AdminContext): Promise<{ slug: string }> {
  await assertAdmin(ctx);
  const productId = parseId(id, "Ürün");
  const input = parseOrThrow(productInputSchema, raw);
  checkTrendyolPrice(input.price, input.trendyolPrice);

  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(products).where(eq(products.id, productId)).for("update");
      if (!current) throw new AdminError("Ürün bulunamadı.");
      await assertCategory(input.categoryId, tx);

      let slug: string;
      if (input.slug) {
        slug = slugBase(input.slug);
        if (!SLUG_RE.test(slug)) throw new AdminError("Adres yalnızca küçük harf, rakam ve tire içerebilir.", "slug");
        if (slug !== current.slug) {
          const [clash] = await tx
            .select({ id: products.id })
            .from(products)
            .where(and(eq(products.slug, slug), ne(products.id, productId)));
          if (clash) throw new AdminError(`"${slug}" adresi başka bir üründe kullanılıyor. Farklı bir adres yazın.`, "slug");
        }
      } else {
        slug = await freeSlug("product", slugBase(input.name), productId, tx);
      }

      if (input.status === "active" && current.status !== "active") {
        const problem = await publishProblem(productId, tx);
        if (problem) throw new AdminError(problem, "status");
      }

      await tx
        .update(products)
        .set({
          name: input.name,
          slug,
          description: input.description,
          details: input.details,
          categoryId: input.categoryId,
          price: input.price,
          trendyolPrice: input.trendyolPrice,
          status: input.status,
          featured: input.featured,
        })
        .where(eq(products.id, productId));

      const changed = (Object.keys(input) as (keyof typeof input)[]).filter((k) =>
        k === "slug" ? slug !== current.slug : input[k] !== current[k],
      );
      await audit(
        {
          action: "product.update",
          actorId: ctx.actorId,
          target: productId,
          data: {
            changed,
            ...(changed.includes("price") ? { price: { from: current.price, to: input.price } } : {}),
            ...(changed.includes("status") ? { status: { from: current.status, to: input.status } } : {}),
          },
          ip: ctx.ip,
        },
        tx,
      );
      return { slug };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AdminError("Bu adres başka bir üründe kullanılıyor. Farklı bir adres yazın.", "slug");
    throw e;
  }
}

/** Yayına alma / taslağa çekme / arşivleme. Ürün silinmez; sipariş geçmişi korunur. */
export async function setProductStatus(id: string, status: ProductStatus, ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const productId = parseId(id, "Ürün");
  const next = parseOrThrow(z.enum(["draft", "active", "archived"]), status, "status");
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: products.status })
      .from(products)
      .where(eq(products.id, productId))
      .for("update");
    if (!current) throw new AdminError("Ürün bulunamadı.");
    if (current.status === next) return;
    if (next === "active") {
      const problem = await publishProblem(productId, tx);
      if (problem) throw new AdminError(problem, "status");
    }
    await tx.update(products).set({ status: next }).where(eq(products.id, productId));
    await audit(
      {
        action: "product.status",
        actorId: ctx.actorId,
        target: productId,
        data: { from: current.status, to: next },
        ip: ctx.ip,
      },
      tx,
    );
  });
}

/**
 * Silme öncesi çağrılır; dönen fonksiyon silme sonrası çağrılınca, yayındaki ürünün son görseli ya
 * da son numarası gittiyse işlemi geri aldırır (vitrinde görselsiz ya da satın alınamaz ürün kalmasın).
 */
async function publishGuard(tx: Tx, productId: string): Promise<() => Promise<void>> {
  const [p] = await tx.select({ status: products.status }).from(products).where(eq(products.id, productId));
  if (p?.status !== "active") return async () => {};
  const before = await mediaCounts(productId, tx);
  return async () => {
    const after = await mediaCounts(productId, tx);
    if ((before.images > 0 && after.images === 0) || (before.sizes > 0 && after.sizes === 0)) {
      throw new AdminError(
        "Yayındaki ürünün son görseli ya da son numarası silinemez. Önce ürünü taslağa alın ya da yenisini ekleyin.",
      );
    }
  };
}

// ---------- Renkler ----------

async function productColorsOf(productId: string, tx: DbOrTx) {
  return tx
    .select({ id: productColors.id, name: productColors.name, position: productColors.position })
    .from(productColors)
    .where(eq(productColors.productId, productId))
    .orderBy(asc(productColors.position), asc(productColors.id));
}

async function colorWithProduct(colorId: string, tx: DbOrTx) {
  const [row] = await tx
    .select({ id: productColors.id, name: productColors.name, productId: productColors.productId })
    .from(productColors)
    .where(eq(productColors.id, colorId));
  if (!row) throw new AdminError("Renk bulunamadı. Sayfayı yenileyin.");
  return row;
}

export async function addColor(productId: string, name: string, ctx: AdminContext): Promise<{ id: string }> {
  await assertAdmin(ctx);
  const pid = parseId(productId, "Ürün");
  const colorName = parseOrThrow(colorNameSchema, name, "name");
  return db.transaction(async (tx) => {
    const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, pid)).for("update");
    if (!product) throw new AdminError("Ürün bulunamadı.");
    const colors = await productColorsOf(pid, tx);
    if (colors.length >= MAX_COLORS_PER_PRODUCT) throw new AdminError("Bir üründe en fazla 20 renk olabilir.", "name");
    if (colors.some((c) => c.name.toLocaleLowerCase("tr-TR") === colorName.toLocaleLowerCase("tr-TR"))) {
      throw new AdminError(`Bu üründe "${colorName}" rengi zaten var.`, "name");
    }
    const position = colors.reduce((m, c) => Math.max(m, c.position + 1), 0);
    const [row] = await tx
      .insert(productColors)
      .values({ productId: pid, name: colorName, position })
      .returning({ id: productColors.id });
    await audit(
      { action: "color.create", actorId: ctx.actorId, target: pid, data: { colorId: row!.id, name: colorName }, ip: ctx.ip },
      tx,
    );
    return row!;
  });
}

export async function renameColor(colorId: string, name: string, ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const cid = parseId(colorId, "Renk");
  const colorName = parseOrThrow(colorNameSchema, name, "name");
  const color = await colorWithProduct(cid, db);
  if (color.name === colorName) return;
  const siblings = await productColorsOf(color.productId, db);
  if (
    siblings.some((c) => c.id !== cid && c.name.toLocaleLowerCase("tr-TR") === colorName.toLocaleLowerCase("tr-TR"))
  ) {
    throw new AdminError(`Bu üründe "${colorName}" rengi zaten var.`, "name");
  }
  await db.update(productColors).set({ name: colorName }).where(eq(productColors.id, cid));
  await audit({
    action: "color.rename",
    actorId: ctx.actorId,
    target: color.productId,
    data: { colorId: cid, from: color.name, to: colorName },
    ip: ctx.ip,
  });
}

export async function moveColor(colorId: string, direction: "up" | "down", ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const cid = parseId(colorId, "Renk");
  const dir = parseOrThrow(directionSchema, direction);
  await db.transaction(async (tx) => {
    const color = await colorWithProduct(cid, tx);
    await tx.select({ id: products.id }).from(products).where(eq(products.id, color.productId)).for("update");
    const next = reorder(await productColorsOf(color.productId, tx), cid, dir);
    if (!next) return;
    for (const [i, c] of next.entries()) {
      if (c.position !== i) await tx.update(productColors).set({ position: i }).where(eq(productColors.id, c.id));
    }
  });
}

/** Siparişi olan bir varyantı ya da görseli silmek geçmişi bozmasın diye kullanılan kontroller. */
async function orderedVariantIds(variantIds: string[], tx: DbOrTx): Promise<Set<string>> {
  if (variantIds.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ id: orderItems.variantId })
    .from(orderItems)
    .where(inArray(orderItems.variantId, variantIds));
  return new Set(rows.map((r) => r.id).filter((x): x is string => x !== null));
}

/** Sipariş geçmişinde küçük resim olarak kullanılan görsel dosyaları silinmez. */
async function unreferencedKeys(keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const rows = await db
    .selectDistinct({ key: orderItems.imageKey })
    .from(orderItems)
    .where(inArray(orderItems.imageKey, keys));
  const used = new Set(rows.map((r) => r.key));
  return keys.filter((k) => !used.has(k));
}

async function removeFiles(keys: string[]) {
  for (const key of await unreferencedKeys(keys)) {
    await deleteProductImage(key).catch((e) => console.error("Görsel dosyası silinemedi", key, e));
  }
}

export async function deleteColor(colorId: string, ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const cid = parseId(colorId, "Renk");
  const keys = await db.transaction(async (tx) => {
    const color = await colorWithProduct(cid, tx);
    await tx.select({ id: products.id }).from(products).where(eq(products.id, color.productId)).for("update");
    const vs = await tx.select({ id: variants.id }).from(variants).where(eq(variants.colorId, cid));
    if ((await orderedVariantIds(vs.map((v) => v.id), tx)).size > 0) {
      throw new AdminError(
        "Bu rengin siparişi var; silinirse sipariş geçmişi bozulur. Stoklarını 0 yapın ya da ürünü arşivleyin.",
      );
    }
    const imgs = await tx.select({ key: productImages.storageKey }).from(productImages).where(eq(productImages.colorId, cid));
    const guard = await publishGuard(tx, color.productId);
    await tx.delete(productColors).where(eq(productColors.id, cid));
    await guard();
    // Kalan renklerin sırası boşluksuz olsun
    for (const [i, c] of (await productColorsOf(color.productId, tx)).entries()) {
      if (c.position !== i) await tx.update(productColors).set({ position: i }).where(eq(productColors.id, c.id));
    }
    await audit(
      { action: "color.delete", actorId: ctx.actorId, target: color.productId, data: { colorId: cid, name: color.name }, ip: ctx.ip },
      tx,
    );
    return imgs.map((i) => i.key);
  });
  await removeFiles(keys);
}

// ---------- Görseller ----------

async function imagesOf(colorId: string, tx: DbOrTx) {
  return tx
    .select({ id: productImages.id, position: productImages.position })
    .from(productImages)
    .where(eq(productImages.colorId, colorId))
    .orderBy(asc(productImages.position), asc(productImages.id));
}

async function imageWithColor(imageId: string, tx: DbOrTx) {
  const [row] = await tx
    .select({
      id: productImages.id,
      colorId: productImages.colorId,
      storageKey: productImages.storageKey,
      alt: productImages.alt,
      productId: productColors.productId,
    })
    .from(productImages)
    .innerJoin(productColors, eq(productColors.id, productImages.colorId))
    .where(eq(productImages.id, imageId));
  if (!row) throw new AdminError("Görsel bulunamadı. Sayfayı yenileyin.");
  return row;
}

/**
 * Bir renge görsel ekler. Dosya sharp ile doğrulanıp yeniden kodlanır; görsel değilse ya da
 * 10 MB'tan büyükse ImageError mesajı AdminError olarak döner.
 */
export async function addProductImage(
  colorId: string,
  data: Buffer,
  alt: string,
  ctx: AdminContext,
): Promise<{ id: string; key: string }> {
  await assertAdmin(ctx);
  const cid = parseId(colorId, "Renk");
  const altText = parseOrThrow(altSchema, alt ?? "", "alt");
  const color = await colorWithProduct(cid, db);
  if ((await imagesOf(cid, db)).length >= MAX_IMAGES_PER_COLOR) {
    throw new AdminError("Bir renkte en fazla 20 görsel olabilir. Önce kullanılmayanları silin.");
  }

  let stored: Awaited<ReturnType<typeof storeProductImage>>;
  try {
    stored = await storeProductImage(data);
  } catch (e) {
    if (e instanceof ImageError) throw new AdminError(e.message, "file");
    throw e;
  }

  try {
    const row = await db.transaction(async (tx) => {
      await tx.select({ id: productColors.id }).from(productColors).where(eq(productColors.id, cid)).for("update");
      const existing = await imagesOf(cid, tx);
      const position = existing.reduce((m, i) => Math.max(m, i.position + 1), 0);
      const [inserted] = await tx
        .insert(productImages)
        .values({ colorId: cid, storageKey: stored.key, width: stored.width, height: stored.height, alt: altText, position })
        .returning({ id: productImages.id });
      await audit(
        {
          action: "image.create",
          actorId: ctx.actorId,
          target: color.productId,
          data: { colorId: cid, imageId: inserted!.id, key: stored.key },
          ip: ctx.ip,
        },
        tx,
      );
      return inserted!;
    });
    return { id: row.id, key: stored.key };
  } catch (e) {
    // Kayıt yazılamadıysa (ör. renk o arada silindi) dosyalar ortada kalmasın
    await deleteProductImage(stored.key);
    throw e;
  }
}

export async function updateImageAlt(imageId: string, alt: string, ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const iid = parseId(imageId, "Görsel");
  const altText = parseOrThrow(altSchema, alt ?? "", "alt");
  const img = await imageWithColor(iid, db);
  if (img.alt === altText) return;
  await db.update(productImages).set({ alt: altText }).where(eq(productImages.id, iid));
  await audit({ action: "image.alt", actorId: ctx.actorId, target: img.productId, data: { imageId: iid }, ip: ctx.ip });
}

export async function moveImage(imageId: string, direction: "up" | "down", ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const iid = parseId(imageId, "Görsel");
  const dir = parseOrThrow(directionSchema, direction);
  await db.transaction(async (tx) => {
    const img = await imageWithColor(iid, tx);
    await tx.select({ id: productColors.id }).from(productColors).where(eq(productColors.id, img.colorId)).for("update");
    const next = reorder(await imagesOf(img.colorId, tx), iid, dir);
    if (!next) return;
    for (const [i, row] of next.entries()) {
      if (row.position !== i) await tx.update(productImages).set({ position: i }).where(eq(productImages.id, row.id));
    }
  });
}

export async function deleteImage(imageId: string, ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const iid = parseId(imageId, "Görsel");
  const key = await db.transaction(async (tx) => {
    const img = await imageWithColor(iid, tx);
    await tx.select({ id: products.id }).from(products).where(eq(products.id, img.productId)).for("update");
    const guard = await publishGuard(tx, img.productId);
    await tx.delete(productImages).where(eq(productImages.id, iid));
    await guard();
    for (const [i, row] of (await imagesOf(img.colorId, tx)).entries()) {
      if (row.position !== i) await tx.update(productImages).set({ position: i }).where(eq(productImages.id, row.id));
    }
    await audit(
      { action: "image.delete", actorId: ctx.actorId, target: img.productId, data: { imageId: iid, key: img.storageKey }, ip: ctx.ip },
      tx,
    );
    return img.storageKey;
  });
  await removeFiles([key]);
}

// ---------- Numaralar (varyantlar) ----------

const MIN_SIZE = 15;
const MAX_SIZE = 50;
const MAX_SIZES_PER_INPUT = 40;

function normalizeSize(token: string): number {
  const value = Number(token);
  if (!/^\d{1,2}(\.\d)?$/.test(token) || !Number.isFinite(value)) {
    throw new AdminError(`"${token}" geçerli bir numara değil. Örnek: 38 ya da 38.5`, "sizes");
  }
  if (!Number.isInteger(value * 2)) throw new AdminError(`"${token}": yalnızca tam ya da yarım numara (38.5) girilebilir.`, "sizes");
  if (value < MIN_SIZE || value > MAX_SIZE) {
    throw new AdminError(`"${token}": numara ${MIN_SIZE} ile ${MAX_SIZE} arasında olmalı.`, "sizes");
  }
  return value;
}

/**
 * Numara girişini ayrıştırır: "36-41" aralığı (tam numaralar), "38, 39, 40" listesi, yarım numaralar
 * "38.5". Birleştirilebilir: "36-39, 39.5". Sonuç benzersiz ve küçükten büyüğe sıralıdır.
 */
export function parseSizeInput(input: string): string[] {
  const text = (input ?? "").replace(/[–—]/g, "-").trim();
  if (!text) throw new AdminError("Numara yazın. Örnek: 36-41 ya da 38, 38.5, 39", "sizes");
  if (text.length > 300) throw new AdminError("Numara girişi çok uzun.", "sizes");
  const out = new Set<number>();
  for (const raw of text.split(/[,;\s]+/).filter(Boolean)) {
    const range = /^(\d{1,2}(?:\.\d)?)-(\d{1,2}(?:\.\d)?)$/.exec(raw);
    if (range) {
      const from = normalizeSize(range[1]!);
      const to = normalizeSize(range[2]!);
      if (to < from) throw new AdminError(`"${raw}": aralık küçükten büyüğe yazılmalı (ör. 36-41).`, "sizes");
      if (to - from > MAX_SIZES_PER_INPUT) throw new AdminError(`"${raw}": aralık çok geniş.`, "sizes");
      for (let s = from; s <= to; s += 1) out.add(s);
    } else if (raw.includes("-")) {
      throw new AdminError(`"${raw}" anlaşılamadı. Aralığı 36-41 biçiminde yazın.`, "sizes");
    } else {
      out.add(normalizeSize(raw));
    }
    if (out.size > MAX_SIZES_PER_INPUT) throw new AdminError("Tek seferde en fazla 40 numara eklenebilir.", "sizes");
  }
  return [...out].sort((a, b) => a - b).map((n) => String(n));
}

/** Otomatik SKU: FD-<ürün kimliği kısaltması>-<renk sırası>-<numara>, ör. FD-3F2A1C-1-38.5 */
export function buildSku(productId: string, colorIndex: number, size: string): string {
  const short = productId.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `FD-${short}-${colorIndex + 1}-${size}`;
}

async function freeSku(base: string, tx: DbOrTx, excludeId: string | null = null): Promise<string> {
  const rows = await tx
    .select({ sku: variants.sku })
    .from(variants)
    .where(and(or(eq(variants.sku, base), like(variants.sku, `${escapeLike(base)}-%`)), excludeId ? ne(variants.id, excludeId) : undefined));
  const taken = new Set(rows.map((r) => r.sku));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export async function addVariants(
  colorId: string,
  sizesInput: string,
  initialStock: number,
  ctx: AdminContext,
): Promise<{ added: string[]; skipped: string[] }> {
  await assertAdmin(ctx);
  const cid = parseId(colorId, "Renk");
  const sizes = parseSizeInput(sizesInput);
  const stock = parseOrThrow(stockSchema, initialStock, "stock");

  try {
    return await db.transaction(async (tx) => {
      const color = await colorWithProduct(cid, tx);
      await tx.select({ id: productColors.id }).from(productColors).where(eq(productColors.id, cid)).for("update");
      const colors = await productColorsOf(color.productId, tx);
      const colorIndex = Math.max(0, colors.findIndex((c) => c.id === cid));
      const existing = new Set(
        (await tx.select({ size: variants.size }).from(variants).where(eq(variants.colorId, cid))).map((v) => v.size),
      );
      const added: string[] = [];
      const skipped: string[] = [];
      for (const size of sizes) {
        if (existing.has(size)) {
          skipped.push(size);
          continue;
        }
        const sku = await freeSku(buildSku(color.productId, colorIndex, size), tx);
        const [v] = await tx.insert(variants).values({ colorId: cid, size, sku, stock: 0 }).returning({ id: variants.id });
        if (stock > 0) await setStock(tx, v!.id, stock, { reason: "initial", actorId: ctx.actorId, note: "İlk stok" });
        added.push(size);
      }
      if (added.length > 0) {
        await audit(
          {
            action: "variant.create",
            actorId: ctx.actorId,
            target: color.productId,
            data: { colorId: cid, sizes: added, stock },
            ip: ctx.ip,
          },
          tx,
        );
      }
      return { added, skipped };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AdminError("Numara eklenirken çakışma oldu. Sayfayı yenileyip yeniden deneyin.", "sizes");
    throw e;
  }
}

async function variantWithProduct(variantId: string, tx: DbOrTx) {
  const [row] = await tx
    .select({
      id: variants.id,
      sku: variants.sku,
      barcode: variants.barcode,
      size: variants.size,
      stock: variants.stock,
      colorId: variants.colorId,
      productId: productColors.productId,
    })
    .from(variants)
    .innerJoin(productColors, eq(productColors.id, variants.colorId))
    .where(eq(variants.id, variantId));
  if (!row) throw new AdminError("Numara bulunamadı. Sayfayı yenileyin.");
  return row;
}

export async function updateVariant(
  variantId: string,
  input: { sku: string; barcode: string },
  ctx: AdminContext,
): Promise<void> {
  await assertAdmin(ctx);
  const vid = parseId(variantId, "Numara");
  const sku = parseOrThrow(skuSchema, input.sku, "sku");
  const barcode = parseOrThrow(barcodeSchema, input.barcode ?? "", "barcode") || null;
  if (barcode !== null && barcode.length < 4) throw new AdminError("Barkod en az 4 karakter olmalı ya da boş bırakılmalı.", "barcode");
  const current = await variantWithProduct(vid, db);
  if (current.sku === sku && current.barcode === barcode) return;

  const [skuClash] = await db
    .select({ id: variants.id })
    .from(variants)
    .where(and(eq(variants.sku, sku), ne(variants.id, vid)));
  if (skuClash) throw new AdminError(`"${sku}" SKU'su başka bir numarada kullanılıyor. Benzersiz bir SKU yazın.`, "sku");
  if (barcode) {
    const [barcodeClash] = await db
      .select({ id: variants.id })
      .from(variants)
      .where(and(eq(variants.barcode, barcode), ne(variants.id, vid)));
    if (barcodeClash) throw new AdminError("Bu barkod başka bir numarada kullanılıyor.", "barcode");
  }
  try {
    await db.update(variants).set({ sku, barcode }).where(eq(variants.id, vid));
  } catch (e) {
    if (isUniqueViolation(e)) throw new AdminError(`"${sku}" SKU'su başka bir numarada kullanılıyor.`, "sku");
    throw e;
  }
  await audit({
    action: "variant.update",
    actorId: ctx.actorId,
    target: current.productId,
    data: { variantId: vid, sku: { from: current.sku, to: sku }, barcode: { from: current.barcode, to: barcode } },
    ip: ctx.ip,
  });
}

/** Elle stok düzeltmesi: yeni değer yazılır, fark stok hareketi olarak (sebep + not) kaydedilir. */
export async function adjustVariantStock(
  variantId: string,
  newStock: number,
  note: string,
  ctx: AdminContext,
): Promise<{ from: number; to: number }> {
  await assertAdmin(ctx);
  const vid = parseId(variantId, "Numara");
  const to = parseOrThrow(stockSchema, newStock, "stock");
  const why = parseOrThrow(noteSchema, note ?? "", "note");
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ stock: variants.stock, sku: variants.sku })
      .from(variants)
      .where(eq(variants.id, vid))
      .for("update");
    if (!locked) throw new AdminError("Numara bulunamadı. Sayfayı yenileyin.");
    if (locked.stock === to) return { from: to, to };
    await setStock(tx, vid, to, { reason: "manual", note: why, actorId: ctx.actorId });
    await audit(
      { action: "stock.adjust", actorId: ctx.actorId, target: locked.sku, data: { variantId: vid, from: locked.stock, to, note: why }, ip: ctx.ip },
      tx,
    );
    return { from: locked.stock, to };
  });
}

export async function deleteVariant(variantId: string, ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const vid = parseId(variantId, "Numara");
  await db.transaction(async (tx) => {
    const v = await variantWithProduct(vid, tx);
    await tx.select({ id: products.id }).from(products).where(eq(products.id, v.productId)).for("update");
    if ((await orderedVariantIds([vid], tx)).size > 0) {
      throw new AdminError("Bu numaranın siparişi var; silinirse sipariş geçmişi bozulur. Stoğunu 0 yapın.");
    }
    const guard = await publishGuard(tx, v.productId);
    await tx.delete(variants).where(eq(variants.id, vid));
    await guard();
    await audit(
      { action: "variant.delete", actorId: ctx.actorId, target: v.productId, data: { variantId: vid, sku: v.sku, size: v.size }, ip: ctx.ip },
      tx,
    );
  });
}

// ---------- Kategoriler ----------

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Kategori adını yazın.").max(60, "Kategori adı en fazla 60 karakter olabilir."),
  slug: z.string().trim().max(60, "Adres en fazla 60 karakter olabilir.").default(""),
});

export async function listAdminCategories() {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      position: categories.position,
      productCount: sql<number>`(select count(*)::int from products p where p.category_id = "categories"."id")`,
    })
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.name));
}

async function allCategories(tx: DbOrTx) {
  return tx
    .select({ id: categories.id, position: categories.position })
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.name));
}

export async function createCategory(raw: z.input<typeof categoryInputSchema>, ctx: AdminContext): Promise<{ id: string; slug: string }> {
  await assertAdmin(ctx);
  const input = parseOrThrow(categoryInputSchema, raw);
  try {
    const row = await db.transaction(async (tx) => {
      // Sıra numarası için tabloyu kısaca kilitle (eşzamanlı eklemede aynı sıra olmasın)
      await tx.execute(sql`lock table ${categories} in share row exclusive mode`);
      let slug: string;
      if (input.slug) {
        slug = slugBase(input.slug, "");
        if (!slug) throw new AdminError("Adres yalnızca harf, rakam ve tire içerebilir.", "slug");
        const [clash] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug));
        if (clash) throw new AdminError(`"${slug}" adresi başka bir kategoride kullanılıyor.`, "slug");
      } else {
        slug = await freeSlug("category", slugBase(input.name, "kategori"), null, tx);
      }
      const position = (await allCategories(tx)).reduce((m, c) => Math.max(m, c.position + 1), 0);
      const [inserted] = await tx
        .insert(categories)
        .values({ name: input.name, slug, position })
        .returning({ id: categories.id, slug: categories.slug });
      await audit({ action: "category.create", actorId: ctx.actorId, target: inserted!.id, data: { name: input.name, slug }, ip: ctx.ip }, tx);
      return inserted!;
    });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new AdminError("Bu adres başka bir kategoride kullanılıyor.", "slug");
    throw e;
  }
}

export async function updateCategory(id: string, raw: z.input<typeof categoryInputSchema>, ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const cid = parseId(id, "Kategori");
  const input = parseOrThrow(categoryInputSchema, raw);
  try {
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(categories).where(eq(categories.id, cid)).for("update");
      if (!current) throw new AdminError("Kategori bulunamadı.");
      const slug = input.slug ? slugBase(input.slug, "") : current.slug;
      if (!slug) throw new AdminError("Adres yalnızca harf, rakam ve tire içerebilir.", "slug");
      if (slug !== current.slug) {
        const [clash] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.slug, slug), ne(categories.id, cid)));
        if (clash) throw new AdminError(`"${slug}" adresi başka bir kategoride kullanılıyor.`, "slug");
      }
      await tx.update(categories).set({ name: input.name, slug }).where(eq(categories.id, cid));
      await audit(
        {
          action: "category.update",
          actorId: ctx.actorId,
          target: cid,
          data: { name: { from: current.name, to: input.name }, slug: { from: current.slug, to: slug } },
          ip: ctx.ip,
        },
        tx,
      );
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AdminError("Bu adres başka bir kategoride kullanılıyor.", "slug");
    throw e;
  }
}

/** Kategoriyi siler; ürünleri silinmez, kategorisiz kalır. */
export async function deleteCategory(id: string, ctx: AdminContext): Promise<{ detached: number }> {
  await assertAdmin(ctx);
  const cid = parseId(id, "Kategori");
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(categories).where(eq(categories.id, cid)).for("update");
    if (!current) throw new AdminError("Kategori bulunamadı.");
    const detached = await tx
      .update(products)
      .set({ categoryId: null })
      .where(eq(products.categoryId, cid))
      .returning({ id: products.id });
    await tx.delete(categories).where(eq(categories.id, cid));
    for (const [i, c] of (await allCategories(tx)).entries()) {
      if (c.position !== i) await tx.update(categories).set({ position: i }).where(eq(categories.id, c.id));
    }
    await audit(
      { action: "category.delete", actorId: ctx.actorId, target: cid, data: { name: current.name, detached: detached.length }, ip: ctx.ip },
      tx,
    );
    return { detached: detached.length };
  });
}

export async function moveCategory(id: string, direction: "up" | "down", ctx: AdminContext): Promise<void> {
  await assertAdmin(ctx);
  const cid = parseId(id, "Kategori");
  const dir = parseOrThrow(directionSchema, direction);
  await db.transaction(async (tx) => {
    await tx.execute(sql`lock table ${categories} in share row exclusive mode`);
    const next = reorder(await allCategories(tx), cid, dir);
    if (!next) throw new AdminError("Kategori bulunamadı.");
    for (const [i, c] of next.entries()) {
      if (c.position !== i) await tx.update(categories).set({ position: i }).where(eq(categories.id, c.id));
    }
  });
}

/** Ürün formundaki kategori seçimi için. */
export async function categoryOptions() {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.name));
}
