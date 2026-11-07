import type { Metadata } from "next";
import { ActionButton } from "@/components/admin/forms";
import { PushToggle } from "@/components/admin/PushToggle";
import { formatDateTime, PageHeader, Section } from "@/components/admin/ui";
import { FormNotice } from "@/components/ui/form";
import { requireAdmin } from "@/server/auth/current";
import { vapidPublicKey } from "@/server/notifications/push";
import { listSubscriptions } from "@/server/services/admin/notifications";
import { removeDeviceAction, sendTestAction, subscribeAction, unsubscribeAction } from "./actions";

export const metadata: Metadata = { title: "Bildirimler" };

export default async function NotificationsPage() {
  const admin = await requireAdmin();
  const key = vapidPublicKey();
  const devices = await listSubscriptions({ actorId: admin.id });
  return (
    <>
      <PageHeader
        title="Bildirimler"
        back={{ href: "/yonetim/ayarlar", label: "Ayarlar" }}
        description="Sitede ya da Trendyol'da yeni sipariş, iade gerektiren ödeme ve stok uyarısı telefonunuza anlık bildirim olarak gelir. Bildirimde müşteri bilgisi yer almaz."
      />
      <div className="max-w-2xl">
        <Section title="Bu cihaz">
          {key ? (
            <PushToggle vapidKey={key} actions={{ subscribe: subscribeAction, unsubscribe: unsubscribeAction }} />
          ) : (
            <FormNotice>Bildirim anahtarları sunucuda tanımlı değil. VAPID anahtarlarını .env.production dosyasına ekleyin (bkz. CANLIYA-ALMA).</FormNotice>
          )}
        </Section>

        <Section title="Kurulum">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[0.8125rem]">
            <li>
              <strong className="font-medium">iPhone:</strong> Safari&apos;de fabrikadann.com/yonetim adresini açın, Paylaş → Ana Ekrana Ekle&apos;ye dokunun.
              Ana ekrandaki Fabrikadann simgesiyle açıp giriş yapın, bu sayfada &quot;Bu cihazda bildirimleri aç&quot;a dokunun.
            </li>
            <li>
              <strong className="font-medium">Android:</strong> Chrome&apos;da fabrikadann.com/yonetim adresini açın, menüden &quot;Ana ekrana ekle&quot;yi seçin,
              uygulamayı açıp bu sayfada &quot;Bu cihazda bildirimleri aç&quot;a dokunun.
            </li>
          </ol>
        </Section>

        <Section
          title="Kayıtlı cihazlarım"
          actions={
            devices.length > 0 && key ? (
              <ActionButton action={sendTestAction} fields={{}} label="Deneme bildirimi gönder" pendingLabel="Gönderiliyor…" />
            ) : undefined
          }
        >
          {devices.length === 0 ? (
            <p className="text-[0.8125rem] text-graphite">Henüz bildirim alan cihazınız yok.</p>
          ) : (
            <ul className="border-t border-rule">
              {devices.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule py-2">
                  <div className="min-w-0 flex-1 text-[0.8125rem]">
                    <p className="font-medium">{d.label}</p>
                    <p className="text-graphite">
                      Eklendi {formatDateTime(d.createdAt)}
                      {d.lastSuccessAt && <> · Son bildirim {formatDateTime(d.lastSuccessAt)}</>}
                    </p>
                  </div>
                  <ActionButton action={removeDeviceAction} fields={{ id: d.id }} label="Kaldır" pendingLabel="Kaldırılıyor…" variant="quiet" />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
