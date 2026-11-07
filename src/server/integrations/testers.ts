import { N11_BASE_URL } from "@/server/marketplaces/n11/client";
import { TrendyolClient, TrendyolError, trendyolConfig } from "@/server/trendyol/client";
import type { Testers, TestResult } from "@/server/services/admin/integrations";

/** Anahtarları ücretsiz, salt okuma isteklerle dener. Yanıttaki sağlayıcı mesajı kısaltılır; anahtar asla yazılmaz. */

async function get(url: string, headers: Record<string, string>): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
    return { status: res.status, text: (await res.text()).slice(0, 2000) };
  } catch {
    return null;
  }
}

function reason(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string }; errorMessage?: string; message?: string };
    return (j.error?.message ?? j.errorMessage ?? j.message ?? "").replace(/\s+/g, " ").slice(0, 160);
  } catch {
    return "";
  }
}

const unreachable: TestResult = { ok: false, message: "Sağlayıcıya ulaşılamadı; biraz sonra yeniden denenecek.", transient: true };

export const defaultTesters: Testers = {
  async claude(v) {
    const r = await get("https://api.anthropic.com/v1/models?limit=1", { "x-api-key": v.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" });
    if (!r) return unreachable;
    if (r.status === 200) return { ok: true, message: "Çalışıyor" };
    if (r.status === 401 || r.status === 403) return { ok: false, message: "Anahtar geçersiz ya da süresi dolmuş." };
    return { ok: false, message: `Claude ${r.status}: ${reason(r.text) || "beklenmeyen yanıt"}` };
  },
  async n11(v) {
    const r = await get(`${N11_BASE_URL}/ms/product-query?page=0&size=1`, { appkey: v.N11_API_KEY ?? "", appsecret: v.N11_API_SECRET ?? "" });
    if (!r) return unreachable;
    if (r.status === 200) return { ok: true, message: "Çalışıyor" };
    if (r.status === 401 || r.status === 403) return { ok: false, message: "N11 anahtar ve şifreyi kabul etmedi; ikisinin aynı API hesabından olduğunu kontrol edin." };
    return { ok: false, message: `N11 ${r.status}: ${reason(r.text) || "beklenmeyen yanıt"}` };
  },
  async trendyol() {
    try {
      const cfg = trendyolConfig();
      if (!cfg) return { ok: false, message: "Tanımlı değil" };
      await new TrendyolClient(cfg).approvedProducts({ page: 0, size: 1 });
      return { ok: true, message: "Çalışıyor" };
    } catch (e) {
      if (e instanceof TrendyolError) return { ok: false, message: e.message.slice(0, 200), transient: !e.status };
      return { ok: false, message: "Trendyol'a ulaşılamadı.", transient: true };
    }
  },
};
