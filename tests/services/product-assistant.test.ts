import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import type { N11Attribute } from "@/server/marketplaces/n11/client";
import { AiAssistantError, suggestForProduct, validateSuggestion, type AssistantClient, type SuggestContext } from "@/server/ai/product-assistant";
import { storeProductImage } from "@/server/storage/images";
import { makeProduct, makeUser, resetDb } from "../helpers/db";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "fd-asistan-"));
  process.env.UPLOAD_DIR = dir;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(resetDb);

const N11_ATTRS: N11Attribute[] = [
  { id: 7794, name: "Topuk Tipi", mandatory: false, variant: false, slicer: false, custom: true, values: [{ id: 1, value: "Blok" }] },
  { id: 5000, name: "Materyal", mandatory: false, variant: false, slicer: false, custom: false, values: [{ id: 9, value: "Deri" }] },
];

const ctx: SuggestContext = {
  categories: [{ id: "cat-1", name: "Bot" }],
  colors: [{ id: "col-1", name: "Renk 1" }],
  n11Attributes: N11_ATTRS,
};

const raw = {
  name: "Fermuarlı Kadın Bot",
  description: "Rahat kalıp.",
  details: "Dış yüzey deri görünümlü.",
  categoryId: "cat-1",
  colors: [{ colorId: "col-1", name: "Siyah" }],
  n11Attributes: [{ id: 7794, valueId: 1, customValue: null }],
  notes: ["Malzemeyi kontrol edin"],
};

test("doğrulama: listede olmayan kategori, renk ve N11 değerleri atılır", () => {
  const s = validateSuggestion(
    {
      ...raw,
      categoryId: "uydurma",
      colors: [{ colorId: "baska", name: "Mavi" }, { colorId: "col-1", name: "Siyah" }],
      n11Attributes: [
        { id: 7794, valueId: 1, customValue: null },
        { id: 7794, valueId: 999, customValue: null },
        { id: 5000, valueId: null, customValue: "Süet" },
        { id: 5000, valueId: 9, customValue: null },
        { id: 1234, valueId: null, customValue: "x" },
      ],
    },
    ctx,
  );
  expect(s.categoryId).toBeNull();
  expect(s.colors).toEqual([{ colorId: "col-1", name: "Siyah" }]);
  expect(s.n11Attributes).toEqual([
    { id: 7794, name: "Topuk Tipi", valueId: 1, customValue: null, label: "Blok" },
    { id: 5000, name: "Materyal", valueId: 9, customValue: null, label: "Deri" },
  ]);
});

test("doğrulama: liste değeri adla eşleşirse valueId'ye çevrilir; uzun metin kırpılır", () => {
  const s = validateSuggestion({ ...raw, name: "x".repeat(300), n11Attributes: [{ id: 5000, valueId: null, customValue: "deri" }] }, ctx);
  expect(s.name).toHaveLength(100);
  expect(s.n11Attributes).toEqual([{ id: 5000, name: "Materyal", valueId: 9, customValue: null, label: "Deri" }]);
});

class FakeClient implements AssistantClient {
  calls: Record<string, unknown>[] = [];
  reply: Record<string, unknown> = { parsed_output: raw, stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 300 } };
  beta = {
    messages: {
      parse: (async (params: Record<string, unknown>) => {
        this.calls.push(params);
        return this.reply;
      }) as unknown as AssistantClient["beta"]["messages"]["parse"],
    },
  };
}

async function productWithImages(n = 2) {
  const { product } = await makeProduct({ name: "Yeni ürün" });
  const [color] = await db.select().from(schema.productColors).where(eq(schema.productColors.productId, product.id));
  for (let i = 0; i < n; i++) {
    const img = await storeProductImage(await sharp({ create: { width: 400, height: 500, channels: 3, background: { r: 10 * i, g: 0, b: 0 } } }).png().toBuffer());
    await db.insert(schema.productImages).values({ colorId: color!.id, storageKey: img.key, width: img.width, height: img.height, position: i });
  }
  return { product, color: color! };
}

test("öneri: istek modeli, effort, yedek model ve görseller; kullanım günlüğe", async () => {
  const admin = await makeUser({ role: "admin" });
  const { product, color } = await productWithImages(4);
  const client = new FakeClient();
  client.reply = { ...client.reply, parsed_output: { ...raw, categoryId: null, colors: [{ colorId: color.id, name: "Siyah" }] } };
  const s = await suggestForProduct({ actorId: admin.id }, product.id, { client, n11: null });
  expect(s.colors).toEqual([{ colorId: color.id, name: "Siyah" }]);
  const p = client.calls[0]!;
  expect(p).toMatchObject({ model: "claude-opus-5-5", betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "medium" } });
  const content = (p.messages as { content: { type: string; source?: { media_type: string } }[] }[])[0]!.content;
  const images = content.filter((c) => c.type === "image");
  expect(images).toHaveLength(3);
  expect(images[0]!.source!.media_type).toBe("image/webp");
  const [log] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "ai.product_suggest"));
  expect(log!.data).toMatchObject({ inputTokens: 1200, outputTokens: 300 });
});

test("görselsiz ürün ve reddedilen istek anlaşılır hata verir", async () => {
  const admin = await makeUser({ role: "admin" });
  const { product } = await makeProduct();
  await expect(suggestForProduct({ actorId: admin.id }, product.id, { client: new FakeClient(), n11: null })).rejects.toThrow(/görsel/);
  const p2 = await productWithImages(1);
  const client = new FakeClient();
  client.reply = { parsed_output: null, stop_reason: "refusal", usage: { input_tokens: 10, output_tokens: 0 } };
  const err = await suggestForProduct({ actorId: admin.id }, p2.product.id, { client, n11: null }).catch((e) => e);
  expect(err).toBeInstanceOf(AiAssistantError);
  expect(err.message).toMatch(/öneri üretemedi/);
});

test("anahtar yoksa asistan kapalı", async () => {
  const admin = await makeUser({ role: "admin" });
  const { product } = await productWithImages(1);
  delete process.env.ANTHROPIC_API_KEY;
  await expect(suggestForProduct({ actorId: admin.id }, product.id, { n11: null })).rejects.toThrow(/ANTHROPIC_API_KEY/);
});
