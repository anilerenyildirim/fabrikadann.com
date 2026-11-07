import { z } from "zod";
import type { MarketplaceLine } from "@/server/db/schema";

/**
 * N11 satıcı API'si (REST). Kimlik: her istekte `appkey` ve `appsecret` başlıkları.
 * Ortam: N11_API_KEY, N11_API_SECRET. Adres sabit — sırlar yalnızca N11'e gider.
 * Ayrıntılar: docs/n11-api-ozet.md
 */

export const N11_BASE_URL = "https://api.n11.com";
const INTEGRATOR = "fabrikadann";

export type N11Config = { apiKey: string; apiSecret: string; baseUrl: string };

export class N11Error extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** Bağlantı tanımlı değilse null; yarım tanımda hata. */
export function n11Config(source: Record<string, string | undefined> = process.env): N11Config | null {
  const apiKey = source.N11_API_KEY?.trim();
  const apiSecret = source.N11_API_SECRET?.trim();
  if (!apiKey && !apiSecret) return null;
  if (!apiKey || !apiSecret) throw new N11Error("N11_API_KEY ve N11_API_SECRET birlikte tanımlanmalı");
  return { apiKey, apiSecret, baseUrl: N11_BASE_URL };
}

export type N11Attribute = {
  id: number;
  name: string;
  mandatory: boolean;
  variant: boolean;
  slicer: boolean;
  custom: boolean;
  values: { id: number; value: string }[];
};

/** Fiyatlar kuruş; gönderilirken "1299.90" biçiminde sayı yazılır. */
export type N11Sku = {
  title: string;
  description: string;
  categoryId: number;
  currencyType: "TL";
  productMainId: string;
  preparingDay: number;
  shipmentTemplate: string;
  stockCode: string;
  barcode: string | null;
  quantity: number;
  images: { url: string; order: number }[];
  attributes: { id: number; valueId: number | null; customValue: string | null }[];
  salePrice: number;
  listPrice: number;
  vatRate: number;
};

export type N11Package = {
  id: string;
  orderNumber: string;
  status: string;
  orderDate: Date | null;
  lastModifiedAt: Date | null;
  lines: MarketplaceLine[];
};

export type N11TaskResult = { taskId: string | null; status: string; reasons: string[] };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// ---------- Yanıt şemaları (bilinmeyen alanlar yok sayılır) ----------

const idSchema = z.union([z.number(), z.string()]).transform(String);
const reasonsSchema = z
  .union([z.array(z.unknown()), z.string()])
  .nullish()
  .transform((r) => (r == null ? [] : Array.isArray(r) ? r.map((x) => summarize(String(x))) : [summarize(r)]));

type RawCategory = { id: number; name: string; subCategories?: RawCategory[] | null };
const categorySchema: z.ZodType<RawCategory> = z.lazy(() =>
  z.object({ id: z.number(), name: z.string(), subCategories: z.array(categorySchema).nullish() }),
);

const attributeSchema = z.object({
  attributeId: z.number(),
  attributeName: z.string(),
  isMandatory: z.boolean().nullish(),
  isVariant: z.boolean().nullish(),
  isSlicer: z.boolean().nullish(),
  isCustomValue: z.boolean().nullish(),
  attributeValues: z
    .array(z.object({ id: z.number(), value: z.string() }).nullable().catch(null))
    .nullish()
    .transform((v) => (v ?? []).filter((x): x is { id: number; value: string } => !!x)),
});

const taskSchema = z.object({ id: idSchema.nullish(), status: z.string(), reasons: reasonsSchema });

const lineSchema = z.object({
  stockCode: z.string().trim().min(1).max(255),
  quantity: z.number().int().nonnegative(),
  orderLineId: idSchema,
  orderItemLineItemStatusName: z.string().nullish(),
});

const packageSchema = z.object({
  id: idSchema,
  orderNumber: idSchema,
  shipmentPackageStatus: z.string().trim().min(1),
  lastModifiedDate: z.number().nullish(),
  packageHistories: z
    .array(z.object({ createdDate: z.number().nullish() }).catch({ createdDate: null }))
    .nullish(),
  lines: z.array(z.unknown()).nullish(),
});

const pageSchema = z.object({
  content: z.array(z.unknown()).nullish().transform((c) => c ?? []),
  totalPages: z.number().int().nonnegative().nullish(),
});

function parse<T extends z.ZodType>(schema: T, data: unknown, what: string): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new N11Error(`N11 ${what} yanıtı beklenen biçimde değil`);
  return r.data;
}

/** Fiyatlar N11'in istediği gibi noktalı ve iki ondalıklı sayı olarak yazılır (ör. 1299.90). */
function toJson(body: unknown): string {
  const marker = "__fiyat__";
  return JSON.stringify(body, (key, value) =>
    (key === "salePrice" || key === "listPrice") && typeof value === "number" ? `${marker}${(value / 100).toFixed(2)}` : value,
  ).replace(new RegExp(`"${marker}(\\d+\\.\\d{2})"`, "g"), "$1");
}

export class N11Client {
  constructor(
    private cfg: N11Config,
    private fetchImpl: FetchLike = fetch,
  ) {}

  private async request(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          appkey: this.cfg.apiKey,
          appsecret: this.cfg.apiSecret,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : toJson(body),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new N11Error(`N11'e bağlanılamadı (${e instanceof Error ? e.name : "hata"})`);
    }
    const text = await res.text();
    if (!res.ok) throw new N11Error(`N11 ${res.status}: ${summarize(text)}`, res.status);
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new N11Error("N11 yanıtı okunamadı", res.status);
    }
  }

  /** Yalnızca en alt düzey (ürün açılabilen) kategoriler, "A > B > C" yoluyla. */
  async categories(): Promise<{ id: number; path: string }[]> {
    const raw = parse(z.object({ categories: z.array(categorySchema) }), await this.request("GET", "/cdn/categories"), "kategori");
    const out: { id: number; path: string }[] = [];
    const walk = (list: RawCategory[], prefix: string) => {
      for (const c of list) {
        const path = prefix ? `${prefix} > ${c.name.trim()}` : c.name.trim();
        if (c.subCategories?.length) walk(c.subCategories, path);
        else out.push({ id: c.id, path });
      }
    };
    walk(raw.categories, "");
    return out;
  }

  async categoryAttributes(categoryId: number): Promise<N11Attribute[]> {
    const raw = parse(
      z.object({ categoryAttributes: z.array(z.unknown()).nullish() }),
      await this.request("GET", `/cdn/category/${encodeURIComponent(String(categoryId))}/attribute`),
      "kategori özellikleri",
    );
    const out: N11Attribute[] = [];
    for (const item of raw.categoryAttributes ?? []) {
      const a = attributeSchema.safeParse(item);
      if (!a.success) continue;
      out.push({
        id: a.data.attributeId,
        name: a.data.attributeName.trim(),
        mandatory: !!a.data.isMandatory,
        variant: !!a.data.isVariant,
        slicer: !!a.data.isSlicer,
        custom: !!a.data.isCustomValue,
        values: a.data.attributeValues.map((v) => ({ id: v.id, value: v.value.trim() })),
      });
    }
    return out;
  }

  /** En fazla 1000 SKU. N11 işi kuyruğa alır; sonuç taskDetails ile okunur. */
  async createProducts(skus: N11Sku[]): Promise<N11TaskResult> {
    if (skus.length === 0 || skus.length > 1000) throw new N11Error("Bir istekte 1–1000 SKU gönderilebilir");
    return this.task("POST", "/ms/product/tasks/product-create", { payload: { integrator: INTEGRATOR, skus } });
  }

  /** Stok ve/veya fiyat (kuruş; liste ve satış fiyatı birlikte gönderilir). En fazla 1000 kalem. */
  async updatePriceStock(items: { stockCode: string; quantity?: number; price?: number }[]): Promise<N11TaskResult> {
    if (items.length === 0 || items.length > 1000) throw new N11Error("Bir istekte 1–1000 kalem gönderilebilir");
    const skus = items.map((i) => ({
      stockCode: i.stockCode,
      ...(i.price !== undefined ? { listPrice: i.price, salePrice: i.price, currencyType: "TL" } : {}),
      ...(i.quantity !== undefined ? { quantity: Math.min(Math.max(i.quantity, 0), 999999) } : {}),
    }));
    return this.task("POST", "/ms/product/tasks/price-stock-update", { payload: { integrator: INTEGRATOR, skus } });
  }

  private async task(method: "POST", path: string, body: unknown): Promise<N11TaskResult> {
    const r = parse(taskSchema, await this.request(method, path, body), "görev");
    return { taskId: r.id ?? null, status: r.status, reasons: r.reasons };
  }

  /** Görevin durumu ve SKU sonuçları (tüm sayfalar). */
  async taskDetails(taskId: string): Promise<{ status: string; skus: { stockCode: string; ok: boolean; reasons: string[] }[] }> {
    const skus: { stockCode: string; ok: boolean; reasons: string[] }[] = [];
    let status = "";
    for (let page = 0; page < 20; page++) {
      const raw = parse(
        z.object({
          status: z.string(),
          skus: z
            .object({ content: z.array(z.unknown()).nullish(), totalPages: z.number().nullish(), last: z.boolean().nullish() })
            .nullish(),
        }),
        await this.request("POST", "/ms/product/task-details/page-query", { taskId: Number(taskId), pageable: { page, size: 1000 } }),
        "görev sonucu",
      );
      status = raw.status;
      for (const item of raw.skus?.content ?? []) {
        const s = z.object({ itemCode: z.string(), status: z.string(), reasons: reasonsSchema }).safeParse(item);
        if (s.success) skus.push({ stockCode: s.data.itemCode, ok: s.data.status.toUpperCase() === "SUCCESS", reasons: s.data.reasons });
      }
      const total = raw.skus?.totalPages ?? 1;
      if (raw.skus?.last !== false || page + 1 >= total) break;
    }
    return { status, skus };
  }

  /** Paketler; tarihler son güncellenme zamanına göre (ms). Bir istekte tek durum. */
  async shipmentPackages(input: { start: number; end: number; status: string; page: number }) {
    const q = new URLSearchParams({
      startDate: String(input.start),
      endDate: String(input.end),
      status: input.status,
      orderByField: "true",
      orderByDirection: "ASC",
      page: String(input.page),
      size: "100",
    });
    const raw = parse(pageSchema, await this.request("GET", `/rest/delivery/v1/shipmentPackages?${q}`), "sipariş");
    const packages: N11Package[] = [];
    let skipped = 0;
    for (const item of raw.content) {
      const p = packageSchema.safeParse(item);
      if (!p.success) {
        skipped++;
        continue;
      }
      const lines: MarketplaceLine[] = [];
      for (const rl of p.data.lines ?? []) {
        const l = lineSchema.safeParse(rl);
        if (l.success) lines.push({ stockCode: l.data.stockCode, quantity: l.data.quantity, lineId: l.data.orderLineId, status: l.data.orderItemLineItemStatusName?.trim() ?? "" });
        else skipped++;
      }
      const created = (p.data.packageHistories ?? []).map((h) => h.createdDate).filter((d): d is number => typeof d === "number");
      packages.push({
        id: p.data.id,
        orderNumber: p.data.orderNumber,
        status: p.data.shipmentPackageStatus,
        orderDate: created.length ? new Date(Math.min(...created)) : null,
        lastModifiedAt: p.data.lastModifiedDate ? new Date(p.data.lastModifiedDate) : null,
        lines,
      });
    }
    return { packages, skipped, totalPages: raw.totalPages ?? 1 };
  }

  /** Yeni sipariş satırlarını onaylar (Created → Picking). */
  async approveLines(lineIds: string[]): Promise<{ lineId: string; ok: boolean; reason: string }[]> {
    if (lineIds.length === 0) return [];
    const raw = parse(
      z.object({ content: z.array(z.unknown()).nullish() }),
      await this.request("PUT", "/rest/order/v1/update", { lines: lineIds.map((id) => ({ lineId: Number(id) })), status: "Picking" }),
      "sipariş onayı",
    );
    const out: { lineId: string; ok: boolean; reason: string }[] = [];
    for (const item of raw.content ?? []) {
      const r = z.object({ lineId: idSchema, status: z.string(), reasons: reasonsSchema }).safeParse(item);
      if (r.success) out.push({ lineId: r.data.lineId, ok: r.data.status.toUpperCase() === "SUCCESS", reason: r.data.reasons.join("; ") });
    }
    return out;
  }
}

function summarize(text: string) {
  let message = text;
  try {
    const j = JSON.parse(text) as { message?: string; errors?: { message?: string }[]; reasons?: string[] };
    message = j.errors?.map((e) => e.message).filter(Boolean).join("; ") || j.reasons?.join("; ") || j.message || text;
  } catch {
    // düz metin
  }
  return message.replace(/\s+/g, " ").slice(0, 300);
}
