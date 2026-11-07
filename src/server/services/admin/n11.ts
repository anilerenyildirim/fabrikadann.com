import { and, asc, eq, ilike, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import type { MarketplaceAttr } from "@/server/db/schema";
import type { N11Client } from "@/server/marketplaces/n11/client";
import { N11Error } from "@/server/marketplaces/n11/client";
import { buildSkus, type ListingProblem } from "@/server/marketplaces/n11/listing";
import { getSettings } from "@/server/services/settings";
import { audit } from "../audit";
import { AdminError, assertAdmin, type AdminContext } from "./context";

const CHANNEL = "n11";
const { marketplaceCategories, marketplaceCategoryMap, marketplaceListings, marketplaceTasks } = schema;

/** Servisin kullandığı N11 uçları (testte sahtesi verilir). */
export type N11Api = Pick<N11Client, "categories" | "categoryAttributes" | "createProducts">;

// Ürün sayfasında kendiliğinden doldurulan özellikler: eşleştirmede sorulmaz
const AUTO_ATTRS = ["marka", "renk", "numara", "beden", "kayıtlı ticari unvan", "iletişim adresi", "e-posta"];
const isAuto = (name: string) => AUTO_ATTRS.includes(name.toLocaleLowerCase("tr").trim());

function n11Failure(e: unknown): never {
  if (e instanceof N11Error) throw new AdminError(`N11: ${e.message}`);
  throw e;
}

// ---------- Kategoriler ----------

export async function refreshN11Categories(ctx: AdminContext, api: N11Api): Promise<number> {
  await assertAdmin(ctx);
  const list = await api.categories().catch(n11Failure);
  if (list.length === 0) throw new AdminError("N11 kategori listesi boş geldi; daha sonra yeniden deneyin.");
  await db.transaction(async (tx) => {
    await tx.delete(marketplaceCategories).where(eq(marketplaceCategories.channel, CHANNEL));
    for (let i = 0; i < list.length; i += 1000) {
      await tx
        .insert(marketplaceCategories)
        .values(list.slice(i, i + 1000).map((c) => ({ channel: CHANNEL, externalId: c.id, path: c.path.slice(0, 500) })));
    }
  });
  await audit({ action: "n11.categories_refreshed", actorId: ctx.actorId, ip: ctx.ip ?? null, data: { count: list.length } });
  return list.length;
}

/** Yolun içinde tüm kelimeler geçen kategoriler (en fazla 30). */
export async function searchN11Categories(q: string) {
  const words = q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.replace(/[%_\\]/g, ""));
  if (words.length === 0) return [];
  return db
    .select({ externalId: marketplaceCategories.externalId, path: marketplaceCategories.path })
    .from(marketplaceCategories)
    .where(and(eq(marketplaceCategories.channel, CHANNEL), ...words.map((w) => ilike(marketplaceCategories.path, `%${w}%`))))
    .orderBy(asc(marketplaceCategories.path))
    .limit(30);
}

export async function n11CategoryCount(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(marketplaceCategories).where(eq(marketplaceCategories.channel, CHANNEL));
  return r?.n ?? 0;
}

/** Site kategorileri ve N11 eşleşmeleri. */
export async function getCategoryMappings() {
  const rows = await db
    .select({
      id: schema.categories.id,
      name: schema.categories.name,
      externalCategoryId: marketplaceCategoryMap.externalCategoryId,
      externalPath: marketplaceCategoryMap.externalPath,
      attributes: marketplaceCategoryMap.attributes,
    })
    .from(schema.categories)
    .leftJoin(marketplaceCategoryMap, and(eq(marketplaceCategoryMap.categoryId, schema.categories.id), eq(marketplaceCategoryMap.channel, CHANNEL)))
    .orderBy(asc(schema.categories.position), asc(schema.categories.name));
  return rows;
}

/** Eşleştirme formunda sorulacak özellikler (otomatik doldurulanlar hariç). */
export async function getMappingAttributes(ctx: AdminContext, api: N11Api, externalCategoryId: number) {
  await assertAdmin(ctx);
  const attrs = await api.categoryAttributes(externalCategoryId).catch(n11Failure);
  return attrs.filter((a) => !isAuto(a.name) && !a.variant);
}

const mappingInput = z.object({
  categoryId: z.uuid(),
  externalCategoryId: z.number().int().positive(),
  attributes: z
    .array(z.object({ id: z.number().int().positive(), valueId: z.number().int().positive().nullable(), customValue: z.string().trim().max(255).nullable() }))
    .max(60),
});

export async function saveCategoryMapping(ctx: AdminContext, api: N11Api, raw: z.input<typeof mappingInput>): Promise<void> {
  await assertAdmin(ctx);
  const input = mappingInput.parse(raw);
  const [category] = await db.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.id, input.categoryId));
  if (!category) throw new AdminError("Kategori bulunamadı. Sayfayı yenileyin.");
  const [external] = await db
    .select()
    .from(marketplaceCategories)
    .where(and(eq(marketplaceCategories.channel, CHANNEL), eq(marketplaceCategories.externalId, input.externalCategoryId)));
  if (!external) throw new AdminError("N11 kategorisi bulunamadı. Listeden seçin; liste eskiyse \"Kategorileri N11'den yenile\"ye basın.");

  const attrs = await api.categoryAttributes(input.externalCategoryId).catch(n11Failure);
  const saved: MarketplaceAttr[] = [];
  for (const a of input.attributes) {
    const def = attrs.find((x) => x.id === a.id);
    if (!def || isAuto(def.name) || def.variant) continue;
    const custom = a.customValue?.trim() || null;
    if (a.valueId !== null) {
      if (!def.values.some((v) => v.id === a.valueId)) throw new AdminError(`${def.name} için seçilen değer N11 listesinde yok.`);
      saved.push({ id: def.id, name: def.name, valueId: a.valueId, customValue: null });
    } else if (custom) {
      if (!def.custom) throw new AdminError(`${def.name} için listeden bir değer seçin.`);
      saved.push({ id: def.id, name: def.name, valueId: null, customValue: custom });
    }
  }
  const missing = attrs.filter((a) => a.mandatory && !a.variant && !isAuto(a.name) && !saved.some((s) => s.id === a.id));
  if (missing.length) throw new AdminError(`Zorunlu özellikleri doldurun: ${missing.map((a) => a.name).join(", ")}.`);

  await db
    .insert(marketplaceCategoryMap)
    .values({ channel: CHANNEL, categoryId: input.categoryId, externalCategoryId: input.externalCategoryId, externalPath: external.path, attributes: saved })
    .onConflictDoUpdate({
      target: [marketplaceCategoryMap.channel, marketplaceCategoryMap.categoryId],
      set: { externalCategoryId: input.externalCategoryId, externalPath: external.path, attributes: saved },
    });
  await audit({ action: "n11.category_mapped", actorId: ctx.actorId, ip: ctx.ip ?? null, target: input.categoryId, data: { external: input.externalCategoryId } });
}

export async function deleteCategoryMapping(ctx: AdminContext, categoryId: string): Promise<void> {
  await assertAdmin(ctx);
  await db.delete(marketplaceCategoryMap).where(and(eq(marketplaceCategoryMap.channel, CHANNEL), eq(marketplaceCategoryMap.categoryId, categoryId)));
}

// ---------- Ürünler ----------

export type N11ProductRow = {
  id: string;
  name: string;
  status: string;
  categoryName: string | null;
  mapped: boolean;
  total: number;
  pending: number;
  active: number;
  failed: number;
  /** Henüz gönderilmemiş ya da başarısız numara sayısı (eşlenmişse gönderilebilir) */
  sendable: number;
  errors: string[];
};

/** Arşivlenmemiş ürünler ve N11 durumu. */
export async function listN11Products(): Promise<N11ProductRow[]> {
  const products = await db.query.products.findMany({
    where: ne(schema.products.status, "archived"),
    columns: { id: true, name: true, status: true, categoryId: true },
    with: { category: { columns: { name: true } }, colors: { columns: { id: true }, with: { variants: { columns: { id: true } } } } },
    orderBy: asc(schema.products.name),
  });
  const maps = await db.select({ categoryId: marketplaceCategoryMap.categoryId }).from(marketplaceCategoryMap).where(eq(marketplaceCategoryMap.channel, CHANNEL));
  const mappedSet = new Set(maps.map((m) => m.categoryId));
  const ids = products.map((p) => p.id);
  const listings = ids.length
    ? await db
        .select({ productId: marketplaceListings.productId, status: marketplaceListings.status, error: marketplaceListings.error })
        .from(marketplaceListings)
        .where(and(eq(marketplaceListings.channel, CHANNEL), inArray(marketplaceListings.productId, ids)))
    : [];
  return products.map((p) => {
    const mine = listings.filter((l) => l.productId === p.id);
    const total = p.colors.reduce((n, c) => n + c.variants.length, 0);
    const pending = mine.filter((l) => l.status === "pending").length;
    const active = mine.filter((l) => l.status === "active").length;
    const failed = mine.filter((l) => l.status === "failed").length;
    const mapped = !!p.categoryId && mappedSet.has(p.categoryId);
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      categoryName: p.category?.name ?? null,
      mapped,
      total,
      pending,
      active,
      failed,
      sendable: mapped && p.status === "active" ? total - pending - active : 0,
      errors: [...new Set(mine.filter((l) => l.status === "failed" && l.error).map((l) => l.error!))].slice(0, 3),
    };
  });
}

export type SendResult = { status: "sent" | "nothing" | "failed"; sent: number; problems: ListingProblem[]; message?: string };

/** Ürünün henüz N11'de olmayan (ya da başarısız) numaralarını yükler; sonuç senkronda okunur. */
export async function sendProductToN11(ctx: AdminContext, api: N11Api, productId: string): Promise<SendResult> {
  await assertAdmin(ctx);
  const settings = await getSettings();
  if (!settings.n11ShipmentTemplate.trim()) {
    return {
      status: "failed",
      sent: 0,
      problems: [],
      message: "Kargo şablonu tanımlı değil. N11 panelinde Hesabım > Teslimat Bilgilerim'de bir şablon oluşturup adını Ayarlar > N11'e yazın.",
    };
  }
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, productId),
    with: {
      colors: {
        orderBy: asc(schema.productColors.position),
        with: { images: { orderBy: asc(schema.productImages.position) }, variants: { orderBy: asc(schema.variants.size) } },
      },
    },
  });
  if (!product) return { status: "failed", sent: 0, problems: [], message: "Ürün bulunamadı." };
  if (product.status !== "active") return { status: "failed", sent: 0, problems: [], message: "Yalnızca yayındaki ürünler N11'e gönderilir." };
  const [mapping] = product.categoryId
    ? await db
        .select()
        .from(marketplaceCategoryMap)
        .where(and(eq(marketplaceCategoryMap.channel, CHANNEL), eq(marketplaceCategoryMap.categoryId, product.categoryId)))
    : [];
  if (!mapping) return { status: "failed", sent: 0, problems: [], message: "Ürünün kategorisi N11'e eşleştirilmemiş. Kategoriler > N11 eşleştirme'den eşleştirin." };

  const variantIds = product.colors.flatMap((c) => c.variants.map((v) => v.id));
  const existing = variantIds.length
    ? await db
        .select({ variantId: marketplaceListings.variantId, status: marketplaceListings.status })
        .from(marketplaceListings)
        .where(and(eq(marketplaceListings.channel, CHANNEL), inArray(marketplaceListings.variantId, variantIds)))
    : [];
  const done = new Set(existing.filter((l) => l.status !== "failed").map((l) => l.variantId));
  const todo = product.colors.flatMap((c) => c.variants.filter((v) => !done.has(v.id)));
  if (todo.length === 0) return { status: "nothing", sent: 0, problems: [] };

  const attributes = await api.categoryAttributes(mapping.externalCategoryId).catch(n11Failure);
  const { skus, problems } = buildSkus({
    product: {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      n11Price: product.n11Price,
      colors: product.colors.map((c) => ({
        name: c.name,
        images: c.images.map((i) => i.storageKey),
        variants: c.variants.map((v) => ({ sku: v.sku, size: v.size, stock: v.stock, barcode: v.barcode })),
      })),
    },
    mapping: { externalCategoryId: mapping.externalCategoryId, attributes: mapping.attributes },
    attributes,
    settings,
    company: { name: settings.companyName, address: settings.companyAddress, email: settings.email },
    appUrl: process.env.APP_URL ?? "",
    only: new Set(todo.map((v) => v.sku)),
  });
  if (skus.length === 0) return { status: "failed", sent: 0, problems, message: problems[0]?.reason ?? "Gönderilecek numara yok." };

  const task = await api.createProducts(skus).catch(n11Failure);
  if (!task.taskId || task.status.toUpperCase() === "REJECT") {
    return { status: "failed", sent: 0, problems, message: `N11 reddetti: ${task.reasons.join("; ") || task.status}` };
  }
  const bySku = new Map(todo.map((v) => [v.sku, v]));
  await db.transaction(async (tx) => {
    for (const s of skus) {
      const v = bySku.get(s.stockCode)!;
      await tx
        .insert(marketplaceListings)
        .values({ channel: CHANNEL, variantId: v.id, stockCode: s.stockCode, productId: product.id, status: "pending", taskId: task.taskId, error: null })
        .onConflictDoUpdate({
          target: [marketplaceListings.channel, marketplaceListings.variantId],
          set: { stockCode: s.stockCode, status: "pending", taskId: task.taskId, error: null },
        });
    }
    await tx.insert(marketplaceTasks).values({ channel: CHANNEL, taskId: task.taskId!, kind: "create" }).onConflictDoNothing();
  });
  await audit({ action: "n11.product_sent", actorId: ctx.actorId, ip: ctx.ip ?? null, target: product.id, data: { skus: skus.length, task: task.taskId } });
  return { status: "sent", sent: skus.length, problems };
}
