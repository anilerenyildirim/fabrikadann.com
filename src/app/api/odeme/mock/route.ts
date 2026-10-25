import { randomBytes } from "node:crypto";
import { completePayment, getPendingPayment } from "@/server/services/payments";
import { isSameOriginRequest, mockPaymentsAllowed, PAYMENT_TOKEN_RE } from "@/app/(magaza)/odeme/_lib/payment";

/*
  Test ödeme sayfasının (/odeme/test/[token]) gönderdiği sonucu işler. Yalnızca test ödemesi
  açıkken çalışır; canlıda yalnızca yönetici kullanabilir. Tutar istemciden alınmaz: bekleyen
  ödeme kaydındaki tutar "tahsil edildi" sayılır.
*/

const plain = (status: number, body = "") =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!(await mockPaymentsAllowed())) return plain(404, "Bulunamadı");

  // CSRF: form yalnızca kendi sitemizden gönderilebilir
  if (!isSameOriginRequest(request)) return plain(403, "İzin verilmedi");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return plain(400, "Geçersiz istek");
  }
  const token = form.get("token");
  const result = form.get("sonuc");
  if (typeof token !== "string" || token.length > 100 || !PAYMENT_TOKEN_RE.test(token)) {
    return plain(400, "Geçersiz istek");
  }
  if (result !== "basarili" && result !== "basarisiz") return plain(400, "Geçersiz istek");

  const pending = await getPendingPayment(token);
  if (!pending) return plain(404, "Bulunamadı");

  const success = result === "basarili";
  const outcome = await completePayment({
    token,
    success,
    amount: pending.amount,
    providerRef: `test-${randomBytes(6).toString("hex")}`,
    raw: { source: "mock", result },
  });

  const number = outcome.orderNumber ?? pending.orderNumber;
  // needs_refund / already_processed: sipariş sayfası güncel durumu kendisi anlatır
  const query =
    outcome.status === "paid"
      ? "?odeme=basarili"
      : outcome.status === "failed" || outcome.status === "amount_mismatch"
        ? "?odeme=basarisiz"
        : "";
  // Göreli adres: tarayıcı, formu gönderdiği adrese (geliştirmede yerel ağ adresi de olabilir) döner
  return new Response(null, {
    status: 303,
    headers: { Location: `/siparis/${number}${query}`, "Cache-Control": "no-store" },
  });
}

export function GET() {
  return new Response("Yalnızca POST", { status: 405, headers: { Allow: "POST" } });
}
