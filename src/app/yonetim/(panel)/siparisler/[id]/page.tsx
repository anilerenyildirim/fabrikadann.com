import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderTransitions } from "@/components/admin/OrderTransitions";
import { formatDateTime, OrderStatusTag, PageHeader, Section, table, TableWrap, td, th } from "@/components/admin/ui";
import { ProductImage } from "@/components/ui/ProductImage";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { CARRIERS, countOrdersOfUser, getAdminOrder } from "@/server/services/admin/orders";
import { changeOrderStatusAction } from "../actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireAdmin();
  const order = await getAdminOrder((await params).id);
  return { title: order ? `Sipariş ${order.number}` : "Sipariş bulunamadı" };
}

const PAYMENT_STATUS: Record<string, string> = { pending: "Bekliyor", succeeded: "Başarılı", failed: "Başarısız" };

export default async function OrderDetailPage({ params }: Props) {
  await requireAdmin();
  const order = await getAdminOrder((await params).id);
  if (!order) notFound();
  const otherOrders = order.user ? await countOrdersOfUser(order.user.id) : 0;
  const a = order.shippingAddress;

  return (
    <>
      <PageHeader
        title={order.number}
        back={{ href: "/yonetim/siparisler", label: "Siparişler" }}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <OrderStatusTag status={order.status} />
            <span>{formatDateTime(order.createdAt)}</span>
            <span className="tabular">{formatPrice(order.total)}</span>
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-x-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <Section title="Ürünler">
            <ul className="border-t border-ink">
              {order.items.map((i) => (
                <li key={i.id} className="flex gap-4 border-b border-rule py-4">
                  <div className="w-14 shrink-0">
                    <ProductImage
                      image={i.imageKey ? { key: i.imageKey, width: 400, height: 500, alt: i.productName } : null}
                      sizes="56px"
                      className="w-14"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words">{i.productName}</p>
                    <p className="mt-1 text-[0.8125rem] text-graphite">
                      {i.colorName} · Numara {i.size} · <span className="tabular">{i.sku}</span>
                    </p>
                    <p className="tabular mt-1 text-[0.8125rem]">
                      {i.quantity} × {formatPrice(i.unitPrice)}
                    </p>
                  </div>
                  <p className="tabular shrink-0 text-right">{formatPrice(i.unitPrice * i.quantity)}</p>
                </li>
              ))}
            </ul>
            <dl className="tabular mt-4 ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[0.8125rem]">
              <dt className="text-graphite">Ara toplam</dt>
              <dd className="text-right">{formatPrice(order.subtotal)}</dd>
              <dt className="text-graphite">Kargo</dt>
              <dd className="text-right">{order.shippingFee === 0 ? "Ücretsiz" : formatPrice(order.shippingFee)}</dd>
              <dt className="mt-2 border-t border-ink pt-2">Toplam</dt>
              <dd className="mt-2 border-t border-ink pt-2 text-right">{formatPrice(order.total)}</dd>
            </dl>
          </Section>

          <Section title="Ödemeler" description="Sağlayıcı referansıyla ödeme sağlayıcısının panelinde işlemi bulabilirsiniz.">
            {order.payments.length === 0 ? (
              <p className="text-[0.8125rem] text-graphite">Ödeme denemesi yok.</p>
            ) : (
              <TableWrap label="Ödemeler">
                <table className={`${table} min-w-[520px]`}>
                  <thead>
                    <tr>
                      <th className={th}>Tarih</th>
                      <th className={th}>Sağlayıcı</th>
                      <th className={th}>Referans</th>
                      <th className={`${th} text-right`}>Tutar</th>
                      <th className={th}>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.payments.map((p) => (
                      <tr key={p.id}>
                        <td className={`${td} whitespace-nowrap text-graphite`}>{formatDateTime(p.createdAt)}</td>
                        <td className={td}>{p.provider === "mock" ? "Test ödemesi" : p.provider}</td>
                        <td className={`${td} tabular break-all`}>{p.providerRef ?? "—"}</td>
                        <td className={`${td} tabular text-right whitespace-nowrap`}>{formatPrice(p.amount)}</td>
                        <td className={td}>
                          <span className={p.status === "succeeded" ? "label" : "label text-graphite"}>
                            {PAYMENT_STATUS[p.status] ?? p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            {order.paidAt && <p className="mt-3 text-[0.8125rem] text-graphite">Ödeme onayı: {formatDateTime(order.paidAt)}</p>}
          </Section>
        </div>

        <div className="min-w-0">
          <Section title="Durum">
            {order.status === "cancelled" && (
              <p className="mb-4 text-[0.8125rem] text-graphite">
                {order.cancelReason === "payment_expired"
                  ? "Ödeme 30 dakika içinde tamamlanmadığı için otomatik iptal edildi; ürünler stoğa döndü."
                  : "Yönetici tarafından iptal edildi; ürünler stoğa döndü."}
              </p>
            )}
            {order.carrier && (
              <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.8125rem]">
                <dt className="text-graphite">Kargo firması</dt>
                <dd>{order.carrier}</dd>
                <dt className="text-graphite">Takip numarası</dt>
                <dd className="tabular break-all">{order.trackingNumber}</dd>
              </dl>
            )}
            <OrderTransitions
              action={changeOrderStatusAction}
              orderId={order.id}
              status={order.status}
              allowed={order.allowed}
              carriers={CARRIERS}
            />
          </Section>

          <Section title="Müşteri">
            <p className="break-words">{a.fullName}</p>
            <p className="mt-1 text-[0.8125rem] break-all">
              <a href={`mailto:${order.email}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                {order.email}
              </a>
            </p>
            <p className="text-[0.8125rem]">
              <a href={`tel:${a.phone.replace(/[^\d+]/g, "")}`} className="tabular inline-flex min-h-11 items-center underline underline-offset-4">
                {a.phone}
              </a>
            </p>
            <p className="mt-2 text-[0.8125rem] text-graphite">
              {order.user ? (
                <>
                  Kayıtlı müşteri · {otherOrders} sipariş ·{" "}
                  <Link
                    href={`/yonetim/musteriler?q=${encodeURIComponent(order.user.email)}`}
                    className="inline-flex min-h-11 items-center text-ink underline underline-offset-4"
                  >
                    Müşteri kaydı
                  </Link>
                </>
              ) : (
                "Misafir sipariş (üyeliksiz)"
              )}
            </p>
          </Section>

          <Section title="Teslimat adresi">
            <address className="text-[0.8125rem] leading-relaxed not-italic">
              {a.fullName}
              <br />
              <span className="break-words whitespace-pre-line">{a.line}</span>
              <br />
              {a.district} / {a.city}
            </address>
          </Section>

          <Section title="Sözleşme onayı">
            <p className="text-[0.8125rem] text-graphite">
              {formatDateTime(order.termsAcceptedAt)} · IP <span className="tabular">{order.termsAcceptedIp ?? "—"}</span>
            </p>
          </Section>
        </div>
      </div>
    </>
  );
}
