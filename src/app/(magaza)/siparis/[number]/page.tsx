import { logError } from "@/server/log";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemList, Totals, type SummaryItem } from "@/components/checkout/ItemList";
import { OrderTimeline } from "@/components/checkout/OrderTimeline";
import { PaymentCountdown } from "@/components/checkout/PaymentCountdown";
import { RetryPaymentForm } from "@/components/checkout/RetryPaymentForm";
import { ButtonLink, FormNotice } from "@/components/ui/form";
import { getCurrentUser } from "@/server/auth/current";
import { getAccessibleOrder, ORDER_NUMBER_RE } from "@/server/guest-orders";
import { ORDER_STATUS_LABELS, releaseExpiredOrders, type OrderWithItems } from "@/server/services/orders";

export const metadata: Metadata = {
  title: "Siparişiniz",
  robots: { index: false, follow: false },
};

const TZ = "Europe/Istanbul";
const dateTime = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short", timeZone: TZ });
const clock = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

type Props = {
  params: Promise<{ number: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OrderPage({ params, searchParams }: Props) {
  const { number } = await params;
  if (!ORDER_NUMBER_RE.test(number)) notFound();

  // Yalnızca sahibi ya da bu tarayıcıdaki misafir token'ı görebilir; diğerleri 404 (var olup olmadığı bile belli olmaz)
  let order = await getAccessibleOrder(number);
  if (!order) notFound();

  if (order.status === "awaiting_payment" && order.paymentExpiresAt.getTime() <= Date.now()) {
    // Süresi dolan ödemeyi beklemeden iptal et ve stoğu geri koy, sonra güncel hâli göster.
    // Temizlik başarısız olursa sayfa yine açılır (bakım betiği sonra temizler).
    const cleaned = await releaseExpiredOrders().then(
      () => true,
      (e) => {
        logError("Süresi dolan siparişler iptal edilemedi", e);
        return false;
      },
    );
    if (cleaned) order = (await getAccessibleOrder(number)) ?? order;
  }

  const query = await searchParams;
  const paymentResult = typeof query.odeme === "string" ? query.odeme : undefined;
  const user = await getCurrentUser();
  const isOwnerAccount = user !== null && order.userId === user.id;

  return (
    <div className="px-4 pb-16 pt-6 md:px-6 md:pt-10">
      <PaymentNotice order={order} result={paymentResult} />

      <header className="mt-2">
        <p className="label text-graphite">Sipariş</p>
        <h1 className="wide tabular mt-1 text-[1.0625rem]">{order.number}</h1>
        <p className="mt-2 text-[0.8125rem] text-graphite">{dateTime.format(order.createdAt)}</p>
      </header>

      <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-20 xl:grid-cols-[minmax(0,44rem)_24rem] xl:justify-between">
        <div className="min-w-0 space-y-12">
          <StatusSection order={order} />

          <section aria-labelledby="siparis-urunler">
            <h2 id="siparis-urunler" className="label mb-4">
              Ürünler
            </h2>
            <ItemList items={itemsOf(order)} linkProducts />
          </section>
        </div>

        <aside className="mt-12 space-y-10 lg:mt-0">
          <section aria-labelledby="siparis-tutar">
            <h2 id="siparis-tutar" className="label mb-4">
              Tutar
            </h2>
            <Totals subtotal={order.subtotal} shippingFee={order.shippingFee} total={order.total} />
          </section>

          <section aria-labelledby="siparis-adres" className="text-[0.8125rem]">
            <h2 id="siparis-adres" className="label mb-4">
              Teslimat adresi
            </h2>
            <address className="not-italic leading-relaxed">
              <span className="block">{order.shippingAddress.fullName}</span>
              <span className="block break-words text-graphite">{order.shippingAddress.line}</span>
              <span className="block text-graphite">
                {order.shippingAddress.district} / {order.shippingAddress.city}
              </span>
              <span className="tabular block text-graphite">{order.shippingAddress.phone}</span>
            </address>
            <p className="mt-4 break-all text-graphite">{order.email}</p>
          </section>

          <div className="space-y-3">
            <ButtonLink href="/urunler" variant="secondary" full>
              Alışverişe devam et
            </ButtonLink>
            {isOwnerAccount ? (
              <ButtonLink href="/hesabim/siparisler" variant="quiet" full>
                Tüm siparişlerim
              </ButtonLink>
            ) : (
              <p className="text-[0.75rem] leading-relaxed text-graphite">
                Bu sayfayı yalnızca siparişi verdiğiniz tarayıcıdan açabilirsiniz. Sipariş numaranızı not edin; bir
                sorunuz olursa{" "}
                <Link href="/iletisim" className="text-ink underline underline-offset-2">
                  bize yazın
                </Link>
                .
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

const itemsOf = (order: OrderWithItems): SummaryItem[] =>
  order.items.map((i) => ({
    id: i.id,
    name: i.productName,
    slug: i.productSlug,
    colorName: i.colorName,
    size: i.size,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    // Tüm boyutlar her görsel için üretiliyor; 800 genişlik küçük görsel için yeter
    image: i.imageKey ? { key: i.imageKey, width: 800, height: 1000, alt: i.productName } : null,
  }));

/** Ödeme sayfasından dönüşte gösterilen mesaj; adres çubuğundaki değer değil, siparişin gerçek durumu esas alınır. */
function PaymentNotice({ order, result }: { order: OrderWithItems; result?: string }) {
  if (result === "basarili" && order.paidAt) {
    return (
      <div className="mb-8">
        <FormNotice tone="info">
          <p className="font-medium">Teşekkürler, siparişiniz alındı. Onay e-postası gönderdik.</p>
        </FormNotice>
      </div>
    );
  }
  if (order.status !== "awaiting_payment") return null;
  if (result === "basarisiz") {
    return (
      <div className="mb-8">
        <FormNotice>
          Ödeme tamamlanamadı, tekrar deneyin. Kart bilgilerinizi kontrol edin ya da başka bir kart kullanın.
        </FormNotice>
      </div>
    );
  }
  if (result === "bekleniyor") {
    return (
      <div className="mb-8">
        <FormNotice tone="info">
          Ödemenizin sonucu bankadan bekleniyor. Birkaç dakika içinde bu sayfa güncellenir; kartınızdan çekim
          yapıldıysa ayrıca işlem yapmanız gerekmez.
        </FormNotice>
      </div>
    );
  }
  if (result === "baslatilamadi") {
    return (
      <div className="mb-8">
        <FormNotice>Siparişiniz oluşturuldu ama ödeme sayfası açılamadı. Aşağıdaki butonla tekrar deneyin.</FormNotice>
      </div>
    );
  }
  return null;
}

function StatusSection({ order }: { order: OrderWithItems }) {
  const label = ORDER_STATUS_LABELS[order.status];
  return (
    <section aria-labelledby="siparis-durum">
      <h2 id="siparis-durum" className="label text-graphite">
        Durum
      </h2>
      <p className="wide mt-1 text-[0.9375rem]">{label}</p>

      {order.status === "awaiting_payment" && (
        <div className="mt-6 space-y-5">
          <p className="text-[0.8125rem] leading-relaxed">
            Ürünlerinizi sizin için ayırdık. Siparişin onaylanması için ödemeyi tamamlayın. Son ödeme saati{" "}
            <span className="tabular font-medium">{clock.format(order.paymentExpiresAt)}</span>.{" "}
            <span className="text-graphite">
              <PaymentCountdown
                deadline={order.paymentExpiresAt.getTime()}
                initialMinutes={Math.max(0, Math.ceil((order.paymentExpiresAt.getTime() - Date.now()) / 60_000))}
              />
            </span>
          </p>
          <RetryPaymentForm number={order.number} />
        </div>
      )}

      {(order.status === "preparing" || order.status === "shipped" || order.status === "delivered") && (
        <div className="mt-6">
          <OrderTimeline status={order.status} />
        </div>
      )}

      {order.carrier && order.trackingNumber && (
        <dl className="mt-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-[0.8125rem]">
          <dt className="text-graphite">Kargo firması</dt>
          <dd>{order.carrier}</dd>
          <dt className="text-graphite">Takip no</dt>
          <dd className="tabular break-all">{order.trackingNumber}</dd>
        </dl>
      )}

      {order.status === "cancelled" && (
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-graphite">
          {cancelText(order)} Sorunuz varsa <ContactLink />.
        </p>
      )}
      {order.status === "refunded" && (
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-graphite">
          Bu siparişin iadesi yapıldı. Sorunuz varsa <ContactLink />.
        </p>
      )}
    </section>
  );
}

/** İptal açıklaması: paidAt varsa para kesin alınmıştır; süre dolması iptalinde geç gelen ödeme olabilir. */
function cancelText(order: OrderWithItems): string {
  if (order.paidAt) {
    return "Bu sipariş iptal edildi. Ödediğiniz tutarın tamamı kartınıza iade edilir; iadenin hesabınıza geçmesi bankanıza göre birkaç iş günü sürebilir.";
  }
  if (order.cancelReason === "payment_expired") {
    return "Ödeme süresi içinde tamamlanmadığı için sipariş iptal edildi ve ürünler satışa geri döndü. Ürünleri yeniden sepete ekleyip yeni sipariş oluşturabilirsiniz. Bu arada kartınızdan ödeme çekildiyse tamamı iade edilir.";
  }
  return "Bu sipariş iptal edildi. Kartınızdan ödeme çekildiyse tamamı iade edilir.";
}

function ContactLink() {
  return (
    <Link href="/iletisim" className="text-ink underline underline-offset-2">
      bize yazın
    </Link>
  );
}
