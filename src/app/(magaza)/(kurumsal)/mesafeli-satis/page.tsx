import type { Metadata } from "next";
import Link from "next/link";
import { companyInfo, shippingTerms } from "@/components/legal/company";
import { CompanyDetails, LegalPage } from "@/components/legal/LegalPage";
import { getSettings } from "@/server/services/settings";

// TASLAK: 6502 sayılı TKHK ve Mesafeli Sözleşmeler Yönetmeliği'ne göre hazırlandı; yayına almadan önce hukukçu kontrolü gerekir.

export const metadata: Metadata = {
  title: "Mesafeli satış sözleşmesi",
  description: "fabrikadann.com üzerinden verilen siparişlere uygulanan mesafeli satış sözleşmesi.",
  alternates: { canonical: "/mesafeli-satis" },
};

export default async function DistanceSalesPage() {
  const settings = await getSettings();
  const c = companyInfo(settings);

  return (
    <LegalPage title="Mesafeli satış sözleşmesi">
      <h2>Madde 1 — Taraflar</h2>
      <p>
        <strong>1.1 Satıcı</strong>
      </p>
      <CompanyDetails company={c} />
      <p>Web sitesi: fabrikadann.com (bundan sonra “Site”).</p>
      <p>
        <strong>1.2 Alıcı</strong>
      </p>
      <p>
        Site üzerinden sipariş veren ve sipariş sırasında ad soyad, teslimat adresi, telefon numarası ve e-posta
        adresini beyan eden kişi (bundan sonra “Alıcı”). Alıcının bilgileri sipariş özetinde ve sipariş onayında yer
        alır.
      </p>

      <h2>Madde 2 — Sözleşmenin konusu</h2>
      <p>
        Bu sözleşmenin konusu, Alıcının Site üzerinden elektronik ortamda siparişini verdiği ve nitelikleri ile satış
        fiyatı sipariş özetinde belirtilen ürünlerin satışı ve teslimine ilişkin olarak, 6502 sayılı Tüketicinin
        Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği hükümleri gereğince tarafların hak ve
        yükümlülüklerinin belirlenmesidir.
      </p>

      <h2>Madde 3 — Ürün, fiyat ve ödeme</h2>
      <ol>
        <li>
          Sözleşme konusu ürünlerin türü, modeli, rengi, numarası, adedi, vergiler dahil birim ve toplam satış
          fiyatı ile kargo ücreti, ödeme adımındaki sipariş özetinde gösterilir. Sipariş özeti ve{" "}
          <Link href="/on-bilgilendirme">ön bilgilendirme formu</Link> bu sözleşmenin ayrılmaz parçasıdır.
        </li>
        <li>
          Sitedeki fiyatlar Türk lirası cinsindendir ve KDV dahildir. Sipariş tutarı, siparişin verildiği andaki
          fiyatlarla hesaplanır; sonradan yapılan fiyat değişiklikleri verilmiş siparişleri etkilemez.
        </li>
        <li>
          {shippingTerms(settings)} Kargo ücreti varsa ödemeden önce sipariş özetinde ayrıca gösterilir.
        </li>
        <li>
          Ödeme, kredi kartı veya banka kartıyla, lisanslı ödeme kuruluşu iyzico altyapısı üzerinden yapılır. Kart
          bilgileri Satıcı tarafından görülmez ve saklanmaz.
        </li>
        <li>
          Ödeme, sipariş oluşturulduktan sonra 30 dakika içinde tamamlanmazsa ya da ödeme kuruluşu tarafından
          onaylanmazsa sipariş iptal edilir ve Alıcıdan herhangi bir tutar tahsil edilmez.
        </li>
      </ol>

      <h2>Madde 4 — Teslimat</h2>
      <ol>
        <li>
          Ürünler, Alıcının sipariş sırasında belirttiği Türkiye içindeki teslimat adresine Satıcının anlaşmalı
          olduğu kargo firması aracılığıyla teslim edilir.
        </li>
        <li>
          Satıcı, siparişi, siparişin kendisine ulaştığı andan itibaren en geç 30 (otuz) gün içinde teslim eder. Bu süre içinde
          teslim edilmezse Alıcı sözleşmeyi feshedebilir; bu durumda Satıcı, teslimat masrafları dahil tahsil ettiği
          tüm ödemeleri fesih bildiriminin kendisine ulaştığı tarihten itibaren 14 (on dört) gün içinde, tek seferde
          ve masrafsız olarak iade eder.
        </li>
        <li>
          Sipariş konusu ürünün teslimi imkânsızlaşırsa Satıcı, bu durumu öğrendiği tarihten itibaren 3 (üç) gün
          içinde Alıcıya yazılı olarak ya da kalıcı veri saklayıcısıyla bildirir ve tahsil ettiği tüm ödemeleri
          bildirim tarihinden itibaren en geç 14 (on dört) gün içinde iade eder.
        </li>
        <li>
          Ürün, Alıcıya ya da Alıcının belirlediği üçüncü kişiye teslim edilene kadar oluşan kayıp ve hasarlardan
          Satıcı sorumludur. Teslimat sırasında paketin hasarlı olduğu görülürse kargo görevlisine tutanak
          tutturulması önerilir; bu öneri Alıcının yasal haklarını kısıtlamaz.
        </li>
        <li>
          Kargoya verilen siparişin takip bilgisi Alıcıya bildirilir; üye girişiyle verilen siparişlerde{" "}
          <Link href="/hesabim/siparisler">Hesabım › Siparişlerim</Link> sayfasında da görüntülenir.
        </li>
      </ol>

      <h2>Madde 5 — Cayma hakkı</h2>
      <ol>
        <li>
          Alıcı, ürünü teslim aldığı günden itibaren 14 (on dört) gün içinde hiçbir gerekçe göstermeksizin ve cezai
          şart ödemeksizin sözleşmeden cayma hakkına sahiptir. Ayrı ayrı teslim edilen birden fazla üründe süre, son
          ürünün teslim alındığı gün başlar. Alıcı, cayma hakkını ürünü teslim almadan önce de kullanabilir.
        </li>
        <li>
          Cayma bildiriminin süresi içinde Satıcıya yöneltilmesi yeterlidir. Bildirim, sipariş numarası belirtilerek{" "}
          {c.email} adresine e-postayla, {c.kep} adresine KEP ile ya da {c.address} adresine yazılı olarak
          yapılabilir. Bildirim için Yönetmelik ekindeki cayma formu ya da açık bir beyan kullanılabilir.
        </li>
        <li>
          Alıcı, cayma bildirimini yönelttiği tarihten itibaren 10 (on) gün içinde ürünü Satıcıya geri gönderir. İade
          gönderimi: [İade kargo koşulu — işletme tarafından belirlenecek].
        </li>
        <li>
          Satıcı, cayma bildiriminin kendisine ulaştığı tarihten itibaren 14 (on dört) gün içinde, teslimat
          masrafları dahil tahsil ettiği tüm ödemeleri, Alıcının ödemede kullandığı ödeme aracına uygun şekilde, tek
          seferde ve Alıcıya herhangi bir masraf ya da yükümlülük getirmeden iade eder.
        </li>
        <li>
          Alıcı, cayma süresi içinde ürünü niteliğine uygun şekilde denemesi nedeniyle oluşan değişikliklerden
          sorumlu değildir. Ürünün olağan denemenin ötesinde kullanılması (ör. dış mekânda giyilmesi) nedeniyle
          oluşan değer kaybından Alıcı sorumludur. Ürünün, kutusu ve varsa etiketleriyle birlikte, kargoda zarar
          görmeyecek şekilde paketlenerek gönderilmesi gerekir.
        </li>
        <li>
          Mesafeli Sözleşmeler Yönetmeliği’nin 15. maddesinde sayılan hallerde (ör. Alıcının istekleri ya da kişisel
          ihtiyaçları doğrultusunda hazırlanan ürünler) cayma hakkı kullanılamaz. Sitede satılan standart ürünlerde
          cayma hakkı geçerlidir; istisna bulunan bir ürün varsa bu durum ürün sayfasında ve sipariş özetinde açıkça
          belirtilir.
        </li>
      </ol>
      <p>
        Ayrıntılı adımlar için <Link href="/iade-degisim">İade ve değişim</Link> sayfasına bakın.
      </p>

      <h2>Madde 6 — Ayıplı ürün</h2>
      <p>
        Teslim edilen ürünün ayıplı olması halinde Alıcı, 6502 sayılı Kanun’un 11. maddesi uyarınca sözleşmeden
        dönme, ayıp oranında satış bedelinden indirim isteme, ücretsiz onarım isteme ya da ayıpsız misliyle
        değiştirilmesini isteme haklarından birini kullanabilir. Ayıplı ürünün gönderim masrafları Satıcıya aittir.
        Ayıplı üründen sorumluluk, ürünün teslim tarihinden itibaren iki yıllık zamanaşımı süresine tabidir.
      </p>

      <h2>Madde 7 — Kişisel veriler</h2>
      <p>
        Alıcının kişisel verileri, <Link href="/kvkk">KVKK aydınlatma metninde</Link> açıklanan amaçlarla ve 6698
        sayılı Kişisel Verilerin Korunması Kanunu’na uygun olarak işlenir.
      </p>

      <h2>Madde 8 — Uyuşmazlıkların çözümü</h2>
      <p>
        Bu sözleşmeden doğan uyuşmazlıklarda, Ticaret Bakanlığınca her yıl ilan edilen parasal sınırlar dahilinde
        Alıcının yerleşim yerindeki ya da tüketici işleminin yapıldığı yerdeki Tüketici Hakem Heyetine, bu sınırları
        aşan uyuşmazlıklarda Tüketici Mahkemesine başvurulabilir. Tüketici Mahkemesinde dava açılmadan önce
        mevzuatta öngörülen hallerde arabulucuya başvurulması zorunludur. Başvurular e-Devlet Kapısı üzerinden de
        yapılabilir.
      </p>

      <h2>Madde 9 — Yürürlük</h2>
      <p>
        Alıcı, siparişi onaylamadan önce ön bilgilendirme formunu ve bu sözleşmeyi okuyup elektronik ortamda
        onaylar. Sözleşme, Alıcının siparişi onaylamasıyla kurulur. Satıcı, sözleşme metnini ve sipariş bilgilerini
        Alıcının e-posta adresine iletir ve mevzuatta öngörülen süre boyunca saklar.
      </p>
    </LegalPage>
  );
}
