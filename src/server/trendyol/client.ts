import { z } from "zod";
import type { TrendyolLine } from "@/server/db/schema";

/**
 * Trendyol satıcı API'si (yalnızca ortak stok için gereken uçlar).
 * Kimlik: Basic (API key:secret) + "{sellerId} - SelfIntegration" User-Agent.
 *
 * Ortam değişkenleri: TRENDYOL_SELLER_ID, TRENDYOL_API_KEY, TRENDYOL_API_SECRET,
 * TRENDYOL_ENV (prod | stage; varsayılan prod). Adres sabit tutulur — sırlar yalnızca Trendyol'a gider.
 */

const BASE_URLS = {
  prod: "https://apigw.trendyol.com",
  stage: "https://stageapigw.trendyol.com",
} as const;

export type TrendyolConfig = { sellerId: string; apiKey: string; apiSecret: string; baseUrl: string };

/** Bağlantı tanımlı değilse null (senkron kapalı). Eksik ya da hatalı tanımda hata fırlatır. */
export function trendyolConfig(source: Record<string, string | undefined> = process.env): TrendyolConfig | null {
  const sellerId = source.TRENDYOL_SELLER_ID?.trim();
  const apiKey = source.TRENDYOL_API_KEY?.trim();
  const apiSecret = source.TRENDYOL_API_SECRET?.trim();
  if (!sellerId && !apiKey && !apiSecret) return null;
  if (!sellerId || !apiKey || !apiSecret) {
    throw new TrendyolError("TRENDYOL_SELLER_ID, TRENDYOL_API_KEY ve TRENDYOL_API_SECRET birlikte tanımlanmalı");
  }
  if (!/^\d{1,20}$/.test(sellerId)) throw new TrendyolError("TRENDYOL_SELLER_ID yalnızca rakam olmalı");
  const envName = source.TRENDYOL_ENV?.trim() || "prod";
  if (envName !== "prod" && envName !== "stage") throw new TrendyolError("TRENDYOL_ENV prod ya da stage olmalı");
  return { sellerId, apiKey, apiSecret, baseUrl: BASE_URLS[envName] };
}

export class TrendyolError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

// ---------- Yanıt şemaları (bilinmeyen alanlar yok sayılır) ----------

const idSchema = z.union([z.number(), z.string()]).transform(String);

const lineSchema = z.object({
  barcode: z.string().nullish(),
  quantity: z.number().int().nonnegative(),
  orderLineItemStatusName: z.string().nullish(),
});

const packageSchema = z
  .object({
    id: idSchema.optional(),
    shipmentPackageId: idSchema.optional(),
    orderNumber: idSchema,
    status: z.string().nullish(),
    shipmentPackageStatus: z.string().nullish(),
    orderDate: z.number().nullish(),
    lastModifiedDate: z.number().nullish(),
    lines: z.array(lineSchema).nullish(),
  })
  .transform((p, ctx) => {
    const id = p.shipmentPackageId ?? p.id;
    const status = p.status ?? p.shipmentPackageStatus;
    if (!id || !status) {
      ctx.addIssue({ code: "custom", message: "paket kimliği ya da durumu yok" });
      return z.NEVER;
    }
    return {
      id,
      orderNumber: p.orderNumber,
      status,
      orderDate: p.orderDate ? new Date(p.orderDate) : null,
      lastModifiedAt: p.lastModifiedDate ? new Date(p.lastModifiedDate) : null,
      lines: (p.lines ?? [])
        .filter((l) => l.barcode)
        .map((l): TrendyolLine => ({ barcode: l.barcode!.trim(), quantity: l.quantity, status: l.orderLineItemStatusName ?? "" })),
    };
  });

export type TrendyolPackage = z.output<typeof packageSchema>;

const streamSchema = z.object({
  content: z.array(z.unknown()).nullish().transform((c) => c ?? []),
  hasMore: z.boolean().nullish().transform((h) => h ?? false),
  nextCursor: z.string().nullish(),
});

const batchSchema = z.object({
  // İşlem sürerken liste boş ya da null gelebilir
  items: z
    .array(
      z.object({
        requestItem: z.object({ barcode: z.string().nullish() }).nullish(),
        status: z.string().nullish(),
        failureReasons: z.array(z.unknown()).nullish(),
      }),
    )
    .nullish()
    .transform((i) => i ?? []),
});

/** Beklenmeyen yanıt biçimi de TrendyolError olur: senkron onu yakalayıp kaydeder, çökmez. */
function parseResponse<T extends z.ZodType>(schema: T, data: unknown, what: string): z.output<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new TrendyolError(`Trendyol ${what} yanıtı beklenen biçimde değil`);
  return parsed.data;
}

export type BatchItemResult = { barcode: string; status: "SUCCESS" | "FAILED" | "IN_PROGRESS"; reasons: string[] };

export type InventoryItem = { barcode: string; quantity: number };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class TrendyolClient {
  constructor(
    private cfg: TrendyolConfig,
    private fetchImpl: FetchLike = fetch,
  ) {}

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const auth = Buffer.from(`${this.cfg.apiKey}:${this.cfg.apiSecret}`).toString("base64");
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          "User-Agent": `${this.cfg.sellerId} - SelfIntegration`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new TrendyolError(`Trendyol'a bağlanılamadı (${e instanceof Error ? e.name : "hata"})`);
    }
    const text = await res.text();
    if (!res.ok) {
      // Yanıttan yalnızca kısa bir özet (Trendyol hata mesajı); istek başlıkları asla yazılmaz
      throw new TrendyolError(`Trendyol ${res.status}: ${summarize(text)}`, res.status);
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new TrendyolError("Trendyol yanıtı okunamadı", res.status);
    }
  }

  /** Son güncellenme tarihine göre paket akışı (en yeni önce). Tarihler Unix ms. */
  async ordersStream(input: { start: number; end: number; cursor?: string; size?: number }) {
    const q = new URLSearchParams({
      lastModifiedStartDate: String(input.start),
      lastModifiedEndDate: String(input.end),
      size: String(input.size ?? 200),
    });
    if (input.cursor) q.set("nextCursor", input.cursor);
    const raw = parseResponse(
      streamSchema,
      await this.request("GET", `/integration/order/sellers/${this.cfg.sellerId}/orders/stream?${q}`),
      "sipariş",
    );
    const packages: TrendyolPackage[] = [];
    let skipped = 0;
    for (const item of raw.content) {
      const p = packageSchema.safeParse(item);
      if (p.success) packages.push(p.data);
      else skipped++;
    }
    return { packages, skipped, hasMore: raw.hasMore && !!raw.nextCursor, nextCursor: raw.nextCursor ?? undefined };
  }

  /** Stok güncelleme (fiyat gönderilmez). En fazla 1000 kalem; sonuç toplu işlem kimliğiyle sorgulanır. */
  async updateInventory(items: InventoryItem[]): Promise<string> {
    if (items.length === 0 || items.length > 1000) throw new TrendyolError("Bir istekte 1–1000 kalem gönderilebilir");
    const res = parseResponse(
      z.object({ batchRequestId: z.string().min(1).max(200) }),
      await this.request("POST", `/integration/inventory/sellers/${this.cfg.sellerId}/products/price-and-inventory`, { items }),
      "stok güncelleme",
    );
    return res.batchRequestId;
  }

  async batchResult(batchRequestId: string): Promise<BatchItemResult[]> {
    const raw = parseResponse(
      batchSchema,
      await this.request(
        "GET",
        `/integration/product/sellers/${this.cfg.sellerId}/products/batch-requests/${encodeURIComponent(batchRequestId)}`,
      ),
      "toplu işlem sonucu",
    );
    return raw.items
      .filter((i) => i.requestItem?.barcode)
      .map((i) => ({
        barcode: i.requestItem!.barcode!,
        status: i.status === "SUCCESS" ? "SUCCESS" : i.status === "FAILED" ? "FAILED" : "IN_PROGRESS",
        reasons: (i.failureReasons ?? []).map((r) => summarize(typeof r === "string" ? r : JSON.stringify(r))),
      }));
  }
}

function summarize(text: string) {
  let message = text;
  try {
    const j = JSON.parse(text) as { errors?: { message?: string }[]; message?: string; exception?: string };
    message = j.errors?.map((e) => e.message).filter(Boolean).join("; ") || j.message || j.exception || text;
  } catch {
    // düz metin
  }
  return message.replace(/\s+/g, " ").slice(0, 300);
}
