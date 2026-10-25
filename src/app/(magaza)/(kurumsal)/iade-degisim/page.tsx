import type { Metadata } from "next";
import Link from "next/link";
import { companyInfo, isFilled } from "@/components/legal/company";
import { LegalPage } from "@/components/legal/LegalPage";
import { getSettings } from "@/server/services/settings";

// TASLAK: cayma hakkı kuralları Mesafeli Sözleşmeler Yönetmeliği'ne göre; iade kargo koşulu işletme tarafından belirlenmeli.

export const metadata: Metadata = {
  title: "İade ve değişim",
  description: "Teslimden itibaren 14 gün içinde iade ve değişim. Adımlar, koşullar ve para iadesi.",
  alternates: { canonical: "/iade-degisim" },
};

export default async function ReturnsPage() {
  const c = companyInfo(await getSettings());
  const mail = isFilled(c.email) ? <a href={`mailto:${c.email}`}>{c.email}</a> : c.email;

  return (
    <LegalPage
      title="İade ve değişim"
      lead={
        <p>
          Ürünü teslim aldığınız günden itibaren <strong>14 gün</strong> içinde, gerekçe göstermeden iade
          edebilir ya da numara ve renk değişimi isteyebilirsiniz.
        </p>
      }
    >
      <h2>İade adımları</h2>
      <ol>
        <li>
          <strong>Bize bildirin.</strong> Teslimden itibaren 14 gün içinde sipariş numaranızı ve iade etmek istediğiniz
          ürünleri {mail} adresine yazın. Sipariş numaranızı sipariş onayında ya da üye girişiyle verdiğiniz
          siparişlerde <Link href="/hesabim/siparisler">Hesabım › Siparişlerim</Link> sayfasında bulabilirsiniz.
          Diğer iletişim yolları <Link href="/iletisim">İletişim</Link> sayfasında.
        </li>
        <li>
          <strong>Paketleyin.</strong> Ürünü kutusu ve varsa etiketleriyle birlikte, kargoda zarar görmeyecek şekilde
          paketleyin. Paketin içine sipariş numaranızı yazdığınız bir not koyun.
        </li>
        <li>
          <strong>Gönderin.</strong> Ürünü, bildiriminizden itibaren 10 gün içinde kargoya verin. İade gönderimi:
          [İade kargo koşulu — işletme tarafından belirlenecek].
        </li>
        <li>
          <strong>Para iadesi.</strong> Ödediğiniz tutarın tamamı, kargo ücreti dahil, iade bildiriminizin bize
          ulaştığı tarihten itibaren en geç 14 gün içinde ödemede kullandığınız karta iade edilir. Tutarın kart
          ekstrenize yansıma süresi bankanıza bağlıdır.
        </li>
      </ol>

      <h2>Ürünün durumu</h2>
      <ul>
        <li>
          Ürün kullanılmamış olmalı. Ayakkabıyı evde, temiz bir zeminde denemeniz kullanım sayılmaz; dış mekânda
          giyilmiş, tabanı aşınmış ya da kirlenmiş ürünlerde oluşan değer kaybından alıcı sorumludur.
        </li>
        <li>Ürünü kutusuyla gönderin; kutu ayakkabının bir parçasıdır ve kargoda ürünü korur.</li>
      </ul>

      <h2>Değişim</h2>
      <p>
        Numara ya da renk değişimi için de aynı yoldan bize yazın ve istediğiniz numarayı belirtin. Değişim stok
        durumuna bağlıdır; istediğiniz numara ya da renk stokta yoksa ürünü iade alır, ödediğiniz tutarı iade
        ederiz. Değişim gönderimi: [Değişim kargo koşulu — işletme tarafından belirlenecek].
      </p>
      <p>
        En hızlı yol: istediğiniz numarayı yeni bir siparişle hemen alın, elinizdekini yukarıdaki adımlarla iade
        edin.
      </p>

      <h2>Kusurlu ya da hatalı ürün</h2>
      <p>
        Ürün kusurlu çıkarsa ya da siparişinizden farklı bir ürün gönderildiyse, sipariş numaranızla birlikte
        ürünün fotoğraflarını {mail} adresine gönderin. Bu durumda gönderim masrafları bize aittir. Kusurlu ürünlerde
        yasal haklarınız (ücretsiz onarım, değişim, bedel indirimi ya da iade) teslimden itibaren iki yıl boyunca
        geçerlidir; 14 günlük süreyle sınırlı değildir.
      </p>

      <h2>Hasarlı paket</h2>
      <p>
        Paket size hasarlı ulaşırsa mümkünse kargo görevlisine tutanak tutturun ve paketin fotoğrafını çekin; bu
        sizin haklarınızı kısıtlamaz, yalnızca süreci hızlandırır.
      </p>

      <p>
        Yasal ayrıntılar: <Link href="/mesafeli-satis">Mesafeli satış sözleşmesi</Link>,{" "}
        <Link href="/on-bilgilendirme">Ön bilgilendirme formu</Link>.
      </p>
    </LegalPage>
  );
}
