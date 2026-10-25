import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/form";
import { formatPrice } from "@/lib/money";
import { getPendingPayment } from "@/server/services/payments";
import { mockPaymentsAllowed, PAYMENT_TOKEN_RE } from "../../_lib/payment";

export const metadata: Metadata = {
  title: "Test ödemesi",
  robots: { index: false, follow: false },
};

export default async function TestPaymentPage({ params }: { params: Promise<{ token: string }> }) {
  if (!(await mockPaymentsAllowed())) notFound();
  const { token } = await params;
  if (!PAYMENT_TOKEN_RE.test(token)) notFound();
  const pending = await getPendingPayment(token);
  if (!pending) notFound();

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-16 pt-10 md:pt-16">
      <p className="border-2 border-ink px-4 py-3 text-center text-[0.8125rem]" role="note">
        <strong className="wide font-medium">TEST ÖDEMESİ</strong> — gerçek para çekilmez
      </p>

      <h1 className="wide mt-12 text-[0.9375rem]">Ödeme</h1>
      <p className="mt-3 text-[0.8125rem] text-graphite">
        Bu sayfa yalnızca deneme içindir; gerçek ödeme sağlayıcısı bağlanınca burada kart formu olacak. Siparişin
        nasıl sonuçlanacağını seçin.
      </p>

      <dl className="mt-10 divide-y divide-rule border-y border-rule text-[0.8125rem]">
        <div className="flex items-baseline justify-between gap-4 py-4">
          <dt className="label text-graphite">Sipariş no</dt>
          <dd className="tabular">{pending.orderNumber}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-4">
          <dt className="label text-graphite">Tutar</dt>
          <dd className="tabular text-base">{formatPrice(pending.amount)}</dd>
        </div>
      </dl>

      <form method="post" action="/api/odeme/mock" className="mt-10 grid gap-3">
        <input type="hidden" name="token" value={token} />
        <Button type="submit" name="sonuc" value="basarili" full>
          Ödeme başarılı
        </Button>
        <Button type="submit" name="sonuc" value="basarisiz" variant="secondary" full>
          Ödeme başarısız
        </Button>
      </form>

      {/* Sipariş sayfası erişimi kendisi denetler (sahibi ya da misafir çerezi) */}
      <ButtonLink href={`/siparis/${pending.orderNumber}`} variant="quiet" full className="mt-6">
        Ödemeden siparişe dön
      </ButtonLink>
    </div>
  );
}
