import type { Metadata } from "next";
import Link from "next/link";
import { N11SendForm } from "@/components/admin/N11SendForm";
import { Empty, PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { N11_NOT_CONFIGURED } from "@/server/marketplaces/n11";
import { n11Config } from "@/server/marketplaces/n11/client";
import { listN11Products } from "@/server/services/admin/n11";
import { getSettings } from "@/server/services/settings";
import { sendToN11Action } from "./actions";

export const metadata: Metadata = { title: "N11'e gönder" };

export default async function N11ProductsPage() {
  await requireAdmin();
  const [products, settings] = await Promise.all([listN11Products(), getSettings()]);
  let blocked: string | null = null;
  try {
    if (!n11Config()) blocked = N11_NOT_CONFIGURED;
  } catch (e) {
    blocked = e instanceof Error ? e.message : "N11 ayarları hatalı.";
  }
  if (!blocked && !settings.n11ShipmentTemplate.trim()) {
    blocked = "Kargo şablonu tanımlı değil. N11 panelinde Hesabım > Teslimat Bilgilerim'de bir şablon oluşturup adını Ayarlar > N11'e yazın.";
  }
  return (
    <>
      <PageHeader
        title="N11'e gönder"
        back={{ href: "/yonetim/urunler", label: "Ürünler" }}
        description={
          <>
            Yayındaki ürünleri N11'e yükler. Her renk × numara ayrı satış kalemi olur, renkler aynı ürün sayfasında toplanır. Fiyat site fiyatının %
            {settings.n11PricePercent} üstüdür (üründe elle N11 fiyatı girilebilir). Stok ve fiyat sonradan kendiliğinden eşitlenir; ürün adı, görsel ve
            özellik değişiklikleri N11'e gitmez (N11 panelinden). Kategorileri önce{" "}
            <Link href="/yonetim/kategoriler/n11" className="underline underline-offset-4">
              N11 eşleştirme
            </Link>{" "}
            sayfasından eşleyin.
          </>
        }
      />
      {products.length === 0 ? <Empty>Ürün yok.</Empty> : <N11SendForm products={products} action={sendToN11Action} blocked={blocked} />}
    </>
  );
}
