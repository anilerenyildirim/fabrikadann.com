import { and, asc, desc, eq, exists, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";

const { products, productColors, productImages, variants, categories } = schema;

export const PAGE_SIZE = 24;

export type ImageRef = { key: string; width: number; height: number; alt: string };

export type ProductCard = {
  id: string;
  slug: string;
  name: string;
  price: number;
  trendyolPrice: number | null;
  image: ImageRef | null;
  hoverImage: ImageRef | null;
  colorCount: number;
  inStock: boolean;
};

export type ListProductsInput = {
  categorySlug?: string;
  q?: string;
  sizes?: string[];
  sort?: "new" | "price_asc" | "price_desc";
  page?: number;
  featuredOnly?: boolean;
};

/** Türkçe harfleri ASCII karşılığına indirip küçültür; arama iki tarafı da bu biçimde karşılaştırır. */
export function foldForSearch(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

const foldSql = (col: SQL | typeof products.name) =>
  sql`lower(translate(${col}, 'İIıŞşĞğÜüÖöÇç', 'iiissgguuoocc'))`;

/** LIKE içindeki özel karakterleri kaçırır. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listCategories() {
  return db.select().from(categories).orderBy(asc(categories.position), asc(categories.name));
}

export async function getCategoryBySlug(slug: string) {
  const [row] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  return row ?? null;
}

/** Bedenleri sayısal sıraya koyar ("36", "36.5", "37" …); sayı olmayanlar sona. */
export function compareSizes(a: string, b: string): number {
  const na = Number.parseFloat(a.replace(",", "."));
  const nb = Number.parseFloat(b.replace(",", "."));
  if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b, "tr");
  return na - nb;
}

export async function listProducts(input: ListProductsInput = {}): Promise<{ items: ProductCard[]; total: number }> {
  const where: SQL[] = [eq(products.status, "active")];

  if (input.categorySlug) {
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(categories)
          .where(and(eq(categories.id, products.categoryId), eq(categories.slug, input.categorySlug))),
      ),
    );
  }

  const q = input.q?.trim().slice(0, 80);
  if (q) {
    const pattern = `%${escapeLike(foldForSearch(q))}%`;
    where.push(sql`(${foldSql(products.name)} LIKE ${pattern} OR ${foldSql(products.description)} LIKE ${pattern})`);
  }

  if (input.sizes?.length) {
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(variants)
          .innerJoin(productColors, eq(productColors.id, variants.colorId))
          .where(
            and(
              eq(productColors.productId, products.id),
              inArray(variants.size, input.sizes.slice(0, 20)),
              sql`${variants.stock} > 0`,
            ),
          ),
      ),
    );
  }

  if (input.featuredOnly) where.push(eq(products.featured, true));

  const order =
    input.sort === "price_asc"
      ? [asc(products.price), desc(products.createdAt)]
      : input.sort === "price_desc"
        ? [desc(products.price), desc(products.createdAt)]
        : [desc(products.createdAt), asc(products.id)];

  const page = Math.max(1, Math.min(input.page ?? 1, 1000));
  const filter = and(...where);

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        price: products.price,
        trendyolPrice: products.trendyolPrice,
      })
      .from(products)
      .where(filter)
      .orderBy(...order)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(products).where(filter),
  ]);

  return { items: await attachCardMedia(rows), total: count?.n ?? 0 };
}

type CardBase = Pick<ProductCard, "id" | "slug" | "name" | "price" | "trendyolPrice">;

async function attachCardMedia(rows: CardBase[]): Promise<ProductCard[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const colors = await db.query.productColors.findMany({
    where: inArray(productColors.productId, ids),
    orderBy: [asc(productColors.position)],
    with: {
      images: { orderBy: [asc(productImages.position)], limit: 2 },
      variants: { columns: { stock: true } },
    },
  });
  return rows.map((row) => {
    const own = colors.filter((c) => c.productId === row.id);
    const first = own.find((c) => c.images.length > 0);
    const toRef = (img?: (typeof own)[number]["images"][number]): ImageRef | null =>
      img ? { key: img.storageKey, width: img.width, height: img.height, alt: img.alt || row.name } : null;
    return {
      ...row,
      image: toRef(first?.images[0]),
      hoverImage: toRef(first?.images[1]),
      colorCount: own.length,
      inStock: own.some((c) => c.variants.some((v) => v.stock > 0)),
    };
  });
}

export async function listFeaturedProducts(limit = 8): Promise<ProductCard[]> {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      price: products.price,
      trendyolPrice: products.trendyolPrice,
    })
    .from(products)
    .where(and(eq(products.status, "active"), eq(products.featured, true)))
    .orderBy(desc(products.updatedAt))
    .limit(limit);
  return attachCardMedia(rows);
}

/** Vitrinde gösterilen numaralar (filtre seçenekleri). */
export async function listAvailableSizes(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ size: variants.size })
    .from(variants)
    .innerJoin(productColors, eq(productColors.id, variants.colorId))
    .innerJoin(products, eq(products.id, productColors.productId))
    .where(and(eq(products.status, "active"), sql`${variants.stock} > 0`));
  return rows.map((r) => r.size).sort(compareSizes);
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductBySlug>>>;

/** Yalnızca yayındaki ürünü döner; taslak ve arşiv ürünler için null. */
export async function getProductBySlug(slug: string) {
  const product = await db.query.products.findFirst({
    where: and(eq(products.slug, slug), eq(products.status, "active")),
    with: {
      category: true,
      colors: {
        orderBy: [asc(productColors.position)],
        with: {
          images: { orderBy: [asc(productImages.position)] },
          variants: { columns: { id: true, size: true, stock: true } },
        },
      },
    },
  });
  if (!product) return null;
  return {
    ...product,
    colors: product.colors.map((c) => ({
      ...c,
      variants: [...c.variants]
        .sort((a, b) => compareSizes(a.size, b.size))
        // Vitrine kesin stok sayısı sızdırılmaz; yalnızca "var / az kaldı / yok"
        .map((v) => ({ id: v.id, size: v.size, availability: availability(v.stock) })),
    })),
  };
}

export type Availability = "in_stock" | "low" | "out";

export function availability(stock: number): Availability {
  if (stock <= 0) return "out";
  if (stock <= 2) return "low";
  return "in_stock";
}
