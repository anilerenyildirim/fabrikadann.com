import type { MetadataRoute } from "next";
import { listCategories, listProducts } from "@/server/services/catalog";

// Derleme anında veritabanına bağlanılmasın; istek anında üretilir
export const dynamic = "force-dynamic";

const MAX_PAGES = 200;
// Ürün sayısı arttıkça tek istek onlarca sorgu demek; sonuç bir süre bellekte tutulur
// (art arda /sitemap.xml istekleri veritabanını yormasın)
const TTL_MS = 10 * 60 * 1000;

let cached: { at: number; entries: Promise<MetadataRoute.Sitemap> } | null = null;

export default function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = Date.now();
  if (!cached || now - cached.at > TTL_MS) {
    const entries = buildSitemap().catch((error: unknown) => {
      cached = null;
      throw error;
    });
    cached = { at: now, entries };
  }
  return cached.entries;
}

async function buildSitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [categories, products] = await Promise.all([listCategories(), allActiveProducts()]);

  return [
    { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/urunler`, changeFrequency: "daily", priority: 0.9 },
    ...categories.map((c) => ({
      url: `${siteUrl}/kategori/${c.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...products.map((slug) => ({
      url: `${siteUrl}/urun/${slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}

/** listProducts yalnızca yayındaki ürünleri döner; sayfa sayfa toplanır. */
async function allActiveProducts(): Promise<string[]> {
  const slugs: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { items, total } = await listProducts({ page });
    slugs.push(...items.map((p) => p.slug));
    if (items.length === 0 || slugs.length >= total) break;
  }
  return slugs;
}
