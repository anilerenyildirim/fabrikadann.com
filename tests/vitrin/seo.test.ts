import { beforeAll, describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db, schema } from "@/server/db";
import { ProductJsonLd } from "@/components/product/ProductJsonLd";
import { cardImageSizes, CARD_IMAGE_SIZES } from "@/components/product/grid";
import type { ProductDetail } from "@/server/services/catalog";
import { makeProduct, resetDb } from "../helpers/db";

const hostile = '</script><script>alert("x")</script><!--';

function detail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
    slug: "deri-sneaker",
    name: hostile,
    description: `Açıklama ${hostile}`,
    price: 189950,
    category: null,
    colors: [
      {
        id: "4f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
        name: "Siyah",
        images: [{ storageKey: "p/5f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b", width: 1600, height: 2000, alt: "" }],
        variants: [{ id: "6f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b", size: "40", availability: "out" }],
      },
    ],
    ...overrides,
  } as unknown as ProductDetail;
}

test("JSON-LD: yönetici metni script etiketinden çıkamaz, veri bozulmaz", () => {
  const html = renderToStaticMarkup(createElement(ProductJsonLd, { product: detail(), siteUrl: "https://fabrikadann.com" }));
  // Tek açılış ve tek kapanış etiketi: içerikteki </script> etkisiz
  expect(html.match(/<script/gi)).toHaveLength(1);
  expect(html.match(/<\/script/gi)).toHaveLength(1);
  expect(html).not.toContain("<!--");

  const json = html.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
  const data = JSON.parse(json);
  expect(data.name).toBe(hostile);
  expect(data.offers).toMatchObject({ priceCurrency: "TRY", price: "1899.50", availability: "https://schema.org/OutOfStock" });
  expect(data.image).toEqual(["https://fabrikadann.com/medya/p/5f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b-1200.webp"]);
});

test("kart görseli genişliği yoğunluğa göre", () => {
  expect(CARD_IMAGE_SIZES).toBe("(min-width: 768px) 25vw, 50vw");
  expect(cardImageSizes({ mobile: 1, desktop: 2 })).toBe("(min-width: 768px) 50vw, 100vw");
});

describe("sitemap", () => {
  beforeAll(async () => {
    await resetDb();
  });

  test("yalnızca yayındaki ürünler ve kategoriler; taslak ürün yok", async () => {
    await db.insert(schema.categories).values({ name: "Bot", slug: "bot" });
    const { product: active } = await makeProduct();
    const { product: draft } = await makeProduct({ status: "draft" });
    const { product: archived } = await makeProduct({ status: "archived" });

    const { default: sitemap } = await import("@/app/sitemap");
    const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${base}/kategori/bot`);
    expect(urls).toContain(`${base}/urun/${active.slug}`);
    expect(urls).not.toContain(`${base}/urun/${draft.slug}`);
    expect(urls).not.toContain(`${base}/urun/${archived.slug}`);

    // Art arda istekler veritabanına yeniden gitmez
    await makeProduct({ name: "Sonradan eklenen" });
    expect(await sitemap()).toHaveLength(urls.length);
  });
});
