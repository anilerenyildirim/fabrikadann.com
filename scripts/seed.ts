// Geliştirme verisi: npm run db:seed  (canlı ortamda çalışmaz)
import "dotenv/config";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "@/server/db";
import { storeProductImage } from "@/server/storage/images";
import { updateSettings } from "@/server/services/settings";
import { slugify } from "@/lib/slug";

if (process.env.NODE_ENV === "production") {
  console.error("Seed canlı ortamda çalıştırılamaz.");
  process.exit(1);
}

type Shape = "sneaker" | "boot" | "loafer";

const SHAPES: Record<Shape, string> = {
  sneaker: `
    <path d="M150 820 L150 700 C150 650 175 630 215 630 L320 630 C350 630 365 650 385 668 C420 700 470 706 525 694 L610 676 C700 658 790 690 850 745 C880 772 895 795 895 815 L895 835 L150 835 Z"/>
    <path d="M140 835 H905 C905 860 890 878 860 878 H170 C150 878 140 860 140 835 Z" opacity="0.85"/>`,
  boot: `
    <path d="M250 860 L250 400 C250 380 265 370 285 370 L480 370 C500 370 510 385 510 405 L515 640 C570 660 650 672 730 692 C810 714 865 762 875 812 L875 860 Z"/>
    <path d="M240 860 H885 V905 H240 Z" opacity="0.85"/>`,
  loafer: `
    <path d="M160 822 C160 760 192 735 242 730 L400 728 C452 727 472 700 522 700 L642 702 C742 706 822 740 862 790 C877 808 882 820 882 832 L160 832 Z"/>
    <path d="M150 832 H892 C892 852 880 862 860 862 H170 C156 862 150 852 150 832 Z" opacity="0.85"/>`,
};

const TONES: Record<string, { bg: string; fill: string; stroke?: string }> = {
  Siyah: { bg: "#efefef", fill: "#161616" },
  Beyaz: { bg: "#e6e6e6", fill: "#fbfbfb", stroke: "#c9c9c9" },
  Taba: { bg: "#f1f1f1", fill: "#7a7a7a" },
  Gri: { bg: "#ececec", fill: "#a3a3a3" },
  Lacivert: { bg: "#efefef", fill: "#3a3a3a" },
};

function placeholderSvg(shape: Shape, color: string, variant: number) {
  const tone = TONES[color] ?? TONES.Siyah!;
  // İkinci görsel: aynalı ve yakın çekim gibi
  const transform = variant === 0 ? "" : "translate(1180 -260) scale(-1.35 1.35)";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1250" viewBox="0 0 1000 1250">
    <rect width="1000" height="1250" fill="${tone.bg}"/>
    <g fill="${tone.fill}" ${tone.stroke ? `stroke="${tone.stroke}" stroke-width="3"` : ""} transform="${transform}">${SHAPES[shape]}</g>
    <text x="40" y="1205" font-family="Arial, sans-serif" font-size="22" letter-spacing="4" fill="#9a9a9a">ÖRNEK GÖRSEL</text>
  </svg>`);
}

const CATEGORIES = ["Kadın", "Erkek", "Sneaker", "Bot", "Loafer"];

const PRODUCTS: {
  name: string;
  shape: Shape;
  price: number;
  categories: string;
  colors: string[];
  sizes: string[];
  description: string;
  featured?: boolean;
}[] = [
  { name: "Deri Sneaker", shape: "sneaker", price: 189900, categories: "Sneaker", colors: ["Beyaz", "Siyah"], sizes: ["36", "37", "38", "39", "40", "41", "42", "43", "44"], description: "Tam deri saya, kauçuk taban. Gün boyu rahatlık için yumuşak iç taban.", featured: true },
  { name: "Süet Bot", shape: "boot", price: 279900, categories: "Bot", colors: ["Taba", "Siyah"], sizes: ["36", "37", "38", "39", "40", "41"], description: "Süet deri, iç yüzeyi astarlı. Kaymaz kauçuk taban.", featured: true },
  { name: "Klasik Loafer", shape: "loafer", price: 219900, categories: "Loafer", colors: ["Siyah", "Taba"], sizes: ["39", "40", "41", "42", "43", "44", "45"], description: "Rugan görünümlü deri, deri iç astar. Ofisten akşam yemeğine.", featured: true },
  { name: "Minimal Sneaker", shape: "sneaker", price: 149900, categories: "Sneaker", colors: ["Beyaz", "Gri"], sizes: ["36", "37", "38", "39", "40", "41", "42", "43"], description: "Sade çizgiler, hafif taban. Her kombine uyar." },
  { name: "Chelsea Bot", shape: "boot", price: 299900, categories: "Bot", colors: ["Siyah"], sizes: ["39", "40", "41", "42", "43", "44"], description: "Yanları lastikli, kolay giyilir. Deri saya, dikişli taban.", featured: true },
  { name: "Püsküllü Loafer", shape: "loafer", price: 239900, categories: "Loafer", colors: ["Taba", "Lacivert"], sizes: ["36", "37", "38", "39", "40"], description: "Yumuşak deri, püskül detaylı. Hafif ve esnek taban." },
  { name: "Kalın Taban Sneaker", shape: "sneaker", price: 209900, categories: "Sneaker", colors: ["Siyah", "Beyaz"], sizes: ["36", "37", "38", "39", "40", "41"], description: "Yükseltilmiş taban, deri ve süet karışımı saya." },
  { name: "Bağcıklı Bot", shape: "boot", price: 319900, categories: "Bot", colors: ["Taba", "Gri"], sizes: ["40", "41", "42", "43", "44", "45"], description: "Su itici deri, yün karışımlı astar. Kış için." },
];

async function main() {
  console.log("Veritabanı temizleniyor (yalnızca katalog)…");
  await db.execute(sql`TRUNCATE categories, products, product_colors, product_images, variants, stock_movements, cart_items, carts RESTART IDENTITY CASCADE`);

  const cats = await db
    .insert(schema.categories)
    .values(CATEGORIES.map((name, i) => ({ name, slug: slugify(name), position: i })))
    .returning();

  let n = 0;
  for (const p of PRODUCTS) {
    n++;
    const category = cats.find((c) => c.name === p.categories)!;
    const [product] = await db
      .insert(schema.products)
      .values({
        name: p.name,
        slug: slugify(p.name),
        description: p.description,
        details: "Saya: deri\nİç astar: deri\nTaban: kauçuk\nÜretim: Türkiye\n\nBakım: nemli bezle silin, doğrudan ısıdan uzak kurutun.",
        categoryId: category.id,
        price: p.price,
        trendyolPrice: Math.round((p.price * 1.18) / 1000) * 1000 - 100,
        status: "active",
        featured: p.featured ?? false,
      })
      .returning();
    for (const [ci, color] of p.colors.entries()) {
      const [c] = await db
        .insert(schema.productColors)
        .values({ productId: product!.id, name: color, position: ci })
        .returning();
      for (const variant of [0, 1]) {
        const png = await sharp(placeholderSvg(p.shape, color, variant)).png().toBuffer();
        const stored = await storeProductImage(png);
        await db.insert(schema.productImages).values({
          colorId: c!.id,
          storageKey: stored.key,
          width: stored.width,
          height: stored.height,
          alt: `${p.name} — ${color}`,
          position: variant,
        });
      }
      for (const [si, size] of p.sizes.entries()) {
        // Bazı numaralar tükenmiş, bazıları az kalmış görünsün
        const stock = (n + ci + si) % 5 === 0 ? 0 : ((n * 3 + si * 7 + ci) % 9) + 1;
        const [v] = await db
          .insert(schema.variants)
          .values({ colorId: c!.id, size, sku: `FD-${String(n).padStart(3, "0")}-${ci + 1}-${size}`, stock })
          .returning();
        if (stock > 0) {
          await db.insert(schema.stockMovements).values({ variantId: v!.id, delta: stock, reason: "initial", note: "Seed" });
        }
      }
    }
    console.log("•", p.name);
  }

  await updateSettings({
    announcement: "Sitemize özel: Trendyol'dan daha uygun fiyat · 1.500 TL üzeri kargo ücretsiz",
    companyName: "fabrikadann",
  });
  console.log("Tamam.");
}

await main();
await pool.end();
