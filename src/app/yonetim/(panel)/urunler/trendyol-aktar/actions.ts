"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/form";
import { rateLimit } from "@/server/auth/rate-limit";
import { audit } from "@/server/services/audit";
import { importTrendyolProducts, type ImportResult } from "@/server/services/admin/trendyol-import";
import { TrendyolClient, TrendyolError, trendyolConfig } from "@/server/trendyol/client";
import { adminContext, errorState } from "../../../_lib/action";

export type ImportState = FormState & { results?: ImportResult[] };

const mainIds = z
  .array(z.string().trim().min(1).max(200))
  .min(1, "Aktarılacak ürünleri seçin.")
  .max(8, "Tek seferde en fazla 8 ürün aktarılabilir. Seçimi azaltın.");

/** Seçilen Trendyol ürünlerini taslak olarak aktarır. Ürün bilgisi istemciden değil Trendyol'dan yeniden okunur. */
export async function importTrendyolAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  const ctx = await adminContext();
  const parsed = mainIds.safeParse(form.getAll("mainId").filter((v): v is string => typeof v === "string"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Geçersiz seçim." };
  // Görsel indirme ve işleme pahalı: hesap başına saatte 30 aktarım
  const limited = await rateLimit(`trendyol-aktar:${ctx.actorId}`, 30, 3600);
  if (!limited.ok) return { error: `Çok sık aktarım yapıldı. ${limited.retryAfter} saniye sonra yeniden deneyin.` };
  let cfg;
  try {
    cfg = trendyolConfig();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Trendyol ayarları hatalı." };
  }
  if (!cfg) return { error: "Trendyol bağlantısı tanımlı değil. Sunucuda TRENDYOL_SELLER_ID, TRENDYOL_API_KEY ve TRENDYOL_API_SECRET tanımlayın." };
  await audit({ action: "trendyol.import_start", actorId: ctx.actorId, ip: ctx.ip, data: { productMainIds: parsed.data } });
  let results: ImportResult[];
  try {
    results = await importTrendyolProducts(parsed.data, ctx, { client: new TrendyolClient(cfg) });
  } catch (e) {
    if (e instanceof TrendyolError) return { error: `Trendyol'dan okunamadı: ${e.message}` };
    return errorState(e, undefined, "trendyol-aktar");
  }
  revalidatePath("/yonetim", "layout");
  const done = results.filter((r) => r.status === "created" || r.status === "updated").length;
  return {
    ok: done > 0,
    message: done > 0 ? `${done} ürün aktarıldı. Taslakları kontrol edip yayına alın.` : undefined,
    error: done === 0 ? "Hiçbir ürün aktarılmadı; ayrıntılar aşağıda." : undefined,
    results,
  };
}
