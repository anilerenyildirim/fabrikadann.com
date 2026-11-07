"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rateLimit } from "@/server/auth/rate-limit";
import { audit } from "@/server/services/audit";
import { importTrendyolProducts, type ImportResult } from "@/server/services/admin/trendyol-import";
import { TrendyolClient, TrendyolError, trendyolConfig } from "@/server/trendyol/client";
import { adminContext, errorState } from "../../../_lib/action";

export type ImportOneState = { result?: ImportResult; error?: string };

const mainIdSchema = z.string().trim().min(1, "Aktarılacak ürünü seçin.").max(200);

/**
 * Tek bir Trendyol ürününü (model kodu) taslak olarak aktarır. Sayfa seçilenleri sırayla tek tek gönderir:
 * böylece ilerleme gösterilebilir ve hiçbir istek vekil zaman aşımına (Cloudflare 100 sn) takılmaz.
 * Ürün bilgisi istemciden değil Trendyol'dan yeniden okunur.
 */
export async function importTrendyolProductAction(rawMainId: unknown): Promise<ImportOneState> {
  const ctx = await adminContext();
  const parsed = mainIdSchema.safeParse(rawMainId);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Geçersiz seçim." };
  // Görsel indirme ve işleme pahalı: hesap başına saatte 120 ürün
  const limited = await rateLimit(`trendyol-aktar:${ctx.actorId}`, 120, 3600);
  if (!limited.ok) return { error: `Çok sık aktarım yapıldı. ${limited.retryAfter} saniye sonra yeniden deneyin.` };
  let cfg;
  try {
    cfg = trendyolConfig();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Trendyol ayarları hatalı." };
  }
  if (!cfg) return { error: "Trendyol bağlantısı tanımlı değil. Sunucuda TRENDYOL_SELLER_ID, TRENDYOL_API_KEY ve TRENDYOL_API_SECRET tanımlayın." };
  await audit({ action: "trendyol.import_start", actorId: ctx.actorId, ip: ctx.ip, data: { productMainIds: [parsed.data] } });
  try {
    const [result] = await importTrendyolProducts([parsed.data], ctx, { client: new TrendyolClient(cfg) });
    revalidatePath("/yonetim", "layout");
    return { result };
  } catch (e) {
    if (e instanceof TrendyolError) return { error: `Trendyol'dan okunamadı: ${e.message}` };
    return { error: errorState(e, undefined, "trendyol-aktar").error ?? "Ürün aktarılamadı." };
  }
}
