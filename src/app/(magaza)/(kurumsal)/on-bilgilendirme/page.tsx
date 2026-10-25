import type { Metadata } from "next";
import Link from "next/link";
import { companyInfo, shippingTerms } from "@/components/legal/company";
import { CompanyDetails, LegalPage } from "@/components/legal/LegalPage";
import { getSettings } from "@/server/services/settings";

// TASLAK: Mesafeli Sözleşmeler Yönetmeliği md. 5'teki başlıklara göre hazırlandı; hukukçu kontrolü gerekir.

export const metadata: Metadata = {
  title: "Ön bilgilendirme formu",
  description: "Mesafeli Sözleşmeler Yönetmeliği uyarınca siparişten önce sunulan ön bilgilendirme formu.",
  alternates: { canonical: "/on-bilgilendirme" },
};

export default async function PreInformationPage() {
  const settings = await getSettings();
  const c = companyInfo(settings);

  return (
    <LegalPage
      title="Ön bilgilendirme formu"
      lead={
        <p>
          Bu form, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca,
          siparişinizi onaylamadan önce sizi bilgilendirmek için hazırlanmıştır. Ödeme adımındaki sipariş özetinde
          yer alan ürün, fiyat ve teslimat bilgileri bu formun parçasıdır.
        </p>
      }
    >
      <h2>1. Satıcı bilgileri</h2>
      <CompanyDetails company={c} />
      <p>
        Şikâyet ve talepleriniz için de yukarıdaki iletişim bilgilerini kullanabilirsiniz; ayrı bir şikâyet kanalı
        yoktur.
      </p>

      <h2>2. Ürünün temel nitelikleri</h2>
      <p>
        Siparişinizdeki ürünlerin modeli, rengi, numarası ve adedi sipariş özetinde; malzeme, kalıp ve bakım
        bilgileri ürün sayfasında yer alır. Ürün görselleri ürünü olabildiğince doğru yansıtacak şekilde çekilir;
        ekran ayarlarına bağlı küçük ton farkları olabilir.
      </p>

      <h2>3. Fiyat ve ek masraflar</h2>
      <ul>
        <li>Fiyatlar Türk lirası cinsindendir ve KDV dahildir.</li>
        <li>{shippingTerms(settings)}</li>
        <li>Siparişin tüm vergiler dahil toplam tutarı, ödemeden önce sipariş özetinde gösterilir.</li>
        <li>Sitenin kullanımı için standart internet bağlantı ücreti dışında ek bir maliyet yoktur.</li>
      </ul>

      <h2>4. Ödeme, teslimat ve ifa</h2>
      <ul>
        <li>
          Ödeme, kredi kartı veya banka kartıyla, lisanslı ödeme kuruluşu iyzico altyapısı üzerinden yapılır. Kart
          bilgileriniz tarafımızca görülmez ve saklanmaz.
        </li>
        <li>Ödeme 30 dakika içinde tamamlanmazsa sipariş iptal edilir; sizden bir tutar tahsil edilmez.</li>
        <li>
          Ürünler, belirttiğiniz Türkiye içindeki adrese anlaşmalı kargo firmasıyla gönderilir ve siparişin bize
          ulaştığı andan itibaren en geç 30 gün içinde teslim edilir.
        </li>
        <li>
          Şikâyetlerinizi e-posta ya da telefonla iletebilirsiniz; şikâyetler kayda alınır ve en kısa sürede
          yanıtlanır.
        </li>
      </ul>

      <h2>5. Cayma hakkı</h2>
      <ul>
        <li>
          Ürünü teslim aldığınız günden itibaren 14 gün içinde gerekçe göstermeden ve cezai şart ödemeden
          sözleşmeden cayabilirsiniz. Ayrı ayrı teslim edilen birden fazla üründe süre son ürünün teslimiyle başlar.
        </li>
        <li>
          Cayma bildiriminizi sipariş numaranızla birlikte {c.email} adresine e-postayla, {c.kep} adresine KEP ile
          ya da {c.address} adresine yazılı olarak iletebilirsiniz.
        </li>
        <li>
          Ürünü, cayma bildiriminizden itibaren 10 gün içinde geri göndermeniz gerekir. İade gönderimi: [İade kargo
          koşulu — işletme tarafından belirlenecek].
        </li>
        <li>
          Ödediğiniz tutarın tamamı, kargo ücreti dahil, cayma bildiriminizin bize ulaştığı tarihten itibaren 14 gün
          içinde ödemede kullandığınız karta iade edilir.
        </li>
      </ul>
      <p>
        Adım adım bilgi için <Link href="/iade-degisim">İade ve değişim</Link> sayfasına bakın.
      </p>

      <h2>6. Cayma hakkının kullanılamadığı durumlar</h2>
      <p>
        Mesafeli Sözleşmeler Yönetmeliği’nin 15. maddesinde sayılan hallerde, örneğin isteğiniz ya da kişisel
        ihtiyaçlarınız doğrultusunda özel olarak hazırlanan ürünlerde cayma hakkı kullanılamaz. Sitede satılan
        standart ürünlerde cayma hakkınız vardır; istisna bulunan bir ürün varsa ürün sayfasında ve sipariş
        özetinde açıkça belirtilir.
      </p>

      <h2>7. Teminat</h2>
      <p>Siparişleriniz için sizden herhangi bir teminat istenmez.</p>

      <h2>8. Dijital içerik</h2>
      <p>Sitede dijital içerik satılmaz; bu nedenle teknik koruma önlemleri ve uyumluluk bilgisi uygulanmaz.</p>

      <h2>9. Uyuşmazlıklar</h2>
      <p>
        Uyuşmazlık halinde, Ticaret Bakanlığınca her yıl ilan edilen parasal sınırlar dahilinde yerleşim yerinizdeki
        ya da işlemi yaptığınız yerdeki Tüketici Hakem Heyetine, bu sınırları aşan uyuşmazlıklarda Tüketici
        Mahkemesine başvurabilirsiniz.
      </p>

      <h2>10. Sözleşme</h2>
      <p>
        Siparişinizi onayladığınızda <Link href="/mesafeli-satis">mesafeli satış sözleşmesi</Link> kurulur. Sözleşme
        ve sipariş bilgileri e-posta adresinize iletilir.
      </p>
    </LegalPage>
  );
}
