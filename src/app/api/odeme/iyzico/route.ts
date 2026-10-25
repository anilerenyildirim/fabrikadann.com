import { retrieveIyzicoOutcome } from "@/server/payments/iyzico";
import { completePayment, findOrderNumberByProviderSession } from "@/server/services/payments";

/*
  iyzico Checkout Form dönüşü: müşterinin tarayıcısı iyzico'dan buraya `token` POST eder.
  Gövdeye güvenilmez — ödemenin sonucu token ile iyzico API'sinden sunucudan sunucuya sorgulanır,
  tutar ve sipariş eşleşmesi completePayment'ta doğrulanır. İstek iyzico'nun alan adından geldiği
  için Origin kontrolü yapılmaz (sahte bir istek yalnızca gerçek sonucun sorgulanmasını tetikler).
*/

const redirect = (location: string) =>
  new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (process.env.PAYMENT_PROVIDER !== "iyzico") return new Response("Bulunamadı", { status: 404 });

  let token: FormDataEntryValue | null = null;
  try {
    token = (await request.formData()).get("token");
  } catch {
    return new Response("Geçersiz istek", { status: 400 });
  }
  if (typeof token !== "string" || !/^[A-Za-z0-9-]{10,100}$/.test(token)) {
    return new Response("Geçersiz istek", { status: 400 });
  }

  const number = await findOrderNumberByProviderSession("iyzico", token);
  if (!number) return new Response("Bulunamadı", { status: 404 });

  try {
    const outcome = await retrieveIyzicoOutcome(token);
    // Sonuç henüz kesin değilse (3DS/inceleme) bakım betiğindeki mutabakat tamamlar
    if (!outcome) return redirect(`/siparis/${number}?odeme=bekleniyor`);
    const result = await completePayment(outcome);
    const query = result.status === "paid" ? "basarili" : result.status === "already_processed" ? "" : "basarisiz";
    return redirect(`/siparis/${number}${query ? `?odeme=${query}` : ""}`);
  } catch (e) {
    console.error("iyzico dönüşü işlenemedi", e);
    return redirect(`/siparis/${number}?odeme=bekleniyor`);
  }
}

export function GET() {
  return new Response("Yalnızca POST", { status: 405, headers: { Allow: "POST" } });
}
