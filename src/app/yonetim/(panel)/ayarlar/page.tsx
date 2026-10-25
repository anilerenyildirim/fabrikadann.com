import type { Metadata } from "next";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { PageHeader } from "@/components/admin/ui";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { getSettings } from "@/server/services/settings";
import { saveSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Ayarlar" };

const tl = (k: number) => formatPrice(k).replace(/\s*TL$/, "");

export default async function SettingsPage() {
  await requireAdmin();
  const s = await getSettings();
  return (
    <>
      <PageHeader title="Ayarlar" description="Değişiklikler kaydedilince vitrinde hemen geçerli olur ve işlem günlüğüne yazılır." />
      <SettingsForm
        action={saveSettingsAction}
        initial={{
          shippingFee: tl(s.shippingFee),
          freeShippingThreshold: tl(s.freeShippingThreshold),
          companyName: s.companyName,
          companyAddress: s.companyAddress,
          taxOffice: s.taxOffice,
          taxNumber: s.taxNumber,
          mersisNumber: s.mersisNumber,
          email: s.email,
          phone: s.phone,
          kepAddress: s.kepAddress,
          instagramUrl: s.instagramUrl,
          trendyolUrl: s.trendyolUrl,
          announcement: s.announcement,
        }}
      />
    </>
  );
}
