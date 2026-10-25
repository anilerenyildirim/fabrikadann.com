import type { Metadata } from "next";
import Link from "next/link";
import { companyInfo } from "@/components/legal/company";
import { CompanyDetails, LegalPage } from "@/components/legal/LegalPage";
import { getSettings } from "@/server/services/settings";

// TASLAK: 6698 sayılı KVKK md. 10 ve Aydınlatma Yükümlülüğü Tebliği'ne göre hazırlandı; hukukçu kontrolü gerekir.

export const metadata: Metadata = {
  title: "KVKK aydınlatma metni",
  description: "fabrikadann.com kişisel verilerin korunması ve işlenmesi hakkında aydınlatma metni.",
  alternates: { canonical: "/kvkk" },
};

const DATA_CATEGORIES = [
  { name: "Kimlik", items: "Ad, soyad." },
  { name: "İletişim", items: "E-posta adresi, telefon numarası." },
  { name: "Adres", items: "Teslimat adresi: alıcı adı, il, ilçe, açık adres." },
  {
    name: "Müşteri işlem ve sipariş",
    items:
      "Sipariş içeriği ve tutarları, sipariş ve ödeme durumu, kargo takip bilgisi, iade ve değişim talepleri, bizimle yazışmalarınız.",
  },
  {
    name: "Finans",
    items:
      "Ödeme işleminin sonucu ve ödeme kuruluşunun işlem referansı. Kart numaranız ve kart bilgileriniz tarafımızca işlenmez ve saklanmaz; bu bilgileri doğrudan ödeme kuruluşu işler.",
  },
  {
    name: "İşlem güvenliği",
    items:
      "IP adresi, oturum bilgileri (oturum çerezi), giriş denemeleri, parolanızdan geri döndürülemez bir yöntemle üretilen özet (parolanızın kendisi saklanmaz), sözleşme onay zamanı ve IP adresi.",
  },
];

export default async function KvkkPage() {
  const settings = await getSettings();
  const c = companyInfo(settings);

  return (
    <LegalPage
      title="KVKK aydınlatma metni"
      lead={
        <p>
          Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca, fabrikadann.com’u (“Site”)
          kullanırken ve alışveriş yaparken kişisel verilerinizin nasıl işlendiğini açıklar.
        </p>
      }
    >
      <h2>1. Veri sorumlusu</h2>
      <p>Kişisel verileriniz, veri sorumlusu sıfatıyla aşağıda bilgileri yer alan şirket tarafından işlenir:</p>
      <CompanyDetails company={c} include={["name", "address", "email", "kep", "mersis"]} />

      <h2>2. İşlenen kişisel veriler</h2>
      <dl className="mb-4 border-t border-rule text-[0.875rem]">
        {DATA_CATEGORIES.map((d) => (
          <div key={d.name} className="grid gap-1 border-b border-rule py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
            <dt className="label pt-0.5 text-graphite">{d.name}</dt>
            <dd className="min-w-0">{d.items}</dd>
          </div>
        ))}
      </dl>
      <p>Özel nitelikli kişisel veri (sağlık, biyometrik veri vb.) işlemiyoruz ve sizden istemiyoruz.</p>

      <h2>3. İşleme amaçları</h2>
      <ul>
        <li>Üyelik hesabınızı oluşturmak ve yönetmek,</li>
        <li>Siparişlerinizi almak, ödemesini almak, hazırlamak ve teslim etmek,</li>
        <li>İade, değişim ve cayma taleplerinizi yürütmek,</li>
        <li>Soru, talep ve şikâyetlerinizi yanıtlamak, sipariş durumu hakkında sizi bilgilendirmek,</li>
        <li>Fatura düzenlemek, muhasebe ve yasal kayıt yükümlülüklerini yerine getirmek,</li>
        <li>Site ve hesap güvenliğini sağlamak; yetkisiz girişi, dolandırıcılığı ve kötüye kullanımı önlemek,</li>
        <li>Yetkili kurum ve kuruluşların yasal taleplerini karşılamak, olası uyuşmazlıklarda haklarımızı korumak.</li>
      </ul>
      <p>
        Kişisel verilerinizi pazarlama amacıyla üçüncü kişilerle paylaşmıyor, satmıyoruz. Size ticari elektronik
        ileti (kampanya e-postası, SMS) göndermiyoruz; ileride göndermek istersek önceden ayrıca onayınızı alırız.
      </p>

      <h2>4. Hukuki sebepler</h2>
      <p>Kişisel verileriniz KVKK’nın 5. maddesinin 2. fıkrasındaki şu hukuki sebeplere dayanılarak işlenir:</p>
      <ul>
        <li>
          <strong>(c) Sözleşmenin kurulması veya ifası:</strong> üyelik, sipariş, ödeme, teslimat, iade ve değişim
          işlemleri.
        </li>
        <li>
          <strong>(ç) Hukuki yükümlülüğün yerine getirilmesi:</strong> vergi ve ticaret mevzuatı kapsamındaki fatura
          ve kayıt yükümlülükleri, tüketici mevzuatı kapsamındaki sözleşme ve onay kayıtları, yetkili kurumların
          talepleri.
        </li>
        <li>
          <strong>(e) Bir hakkın tesisi, kullanılması veya korunması:</strong> olası uyuşmazlıklarda delil olarak
          kullanılacak sipariş ve yazışma kayıtları.
        </li>
        <li>
          <strong>(f) Meşru menfaat:</strong> temel hak ve özgürlüklerinize zarar vermemek kaydıyla, Site ve hesap
          güvenliğinin sağlanması için IP adresi, oturum ve giriş denemesi kayıtları.
        </li>
      </ul>

      <h2>5. Kişisel verilerin aktarılması</h2>
      <p>Kişisel verileriniz, yalnızca yukarıdaki amaçlar için gerekli olduğu ölçüde şu alıcı gruplarına aktarılır:</p>
      <ul>
        <li>
          <strong>Kargo firmaları:</strong> siparişinizin teslimi için ad soyad, teslimat adresi ve telefon numarası.
        </li>
        <li>
          <strong>Ödeme kuruluşu (iyzico):</strong> ödemenin alınması, iadesi ve dolandırıcılığın önlenmesi için ad
          soyad, e-posta adresi, telefon numarası, teslimat ve fatura adresi, IP adresi, sipariş içeriği ve tutarı.
        </li>
        <li>
          <strong>Barındırma, e-posta gönderimi ve teknik hizmet sağlayıcıları:</strong> Sitenin çalışması ve sipariş
          e-postalarının iletilmesi için, verileri yalnızca bizim talimatımızla işleyen hizmet sağlayıcıları.
        </li>
        <li>
          <strong>Muhasebe ve mali müşavirlik hizmeti sağlayıcıları:</strong> fatura ve yasal kayıt yükümlülükleri
          için.
        </li>
        <li>
          <strong>Yetkili kamu kurum ve kuruluşları ile yargı mercileri:</strong> yasal olarak talep edilmesi halinde.
        </li>
      </ul>
      <p>
        Hizmet sağlayıcılarımızın sunucularının yurt dışında bulunması halinde aktarım, KVKK’nın 9. maddesinde
        öngörülen şartlara uygun olarak yapılır.
      </p>

      <h2>6. Toplama yöntemi</h2>
      <p>
        Kişisel verileriniz; üyelik, sipariş, adres ve parola formları, bize gönderdiğiniz e-postalar, yalnızca
        zorunlu çerezler (<Link href="/cerez-politikasi">çerez politikası</Link>) ve sunucu kayıtları aracılığıyla
        elektronik ortamda, kısmen otomatik yollarla toplanır.
      </p>

      <h2>7. Saklama süresi</h2>
      <p>
        Kişisel verileriniz, işleme amacının gerektirdiği süre ve ilgili mevzuatta öngörülen süreler boyunca
        (ör. vergi ve ticaret mevzuatındaki defter ve belge saklama süreleri, tüketici mevzuatındaki sözleşme kaydı
        süreleri) saklanır; bu süreler dolduğunda silinir, yok edilir ya da anonim hale getirilir. Ödemesi
        tamamlanmadığı için iptal edilen siparişlerdeki kişisel veriler 30 gün sonra anonim hale getirilir; güvenlik
        kayıtlarındaki IP adresleri 1 yıl sonra silinir; parola sıfırlama bağlantıları kullanıldıktan ya da süresi
        dolduktan sonra silinir. Hesabınızı
        kapatmak isterseniz bize yazabilirsiniz; yasal saklama yükümlülüğü bulunan kayıtlar dışındaki verileriniz
        silinir.
      </p>

      <h2>8. KVKK’nın 11. maddesindeki haklarınız</h2>
      <p>Bize başvurarak:</p>
      <ul>
        <li>kişisel verilerinizin işlenip işlenmediğini öğrenme,</li>
        <li>işlenmişse buna ilişkin bilgi talep etme,</li>
        <li>işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
        <li>yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,</li>
        <li>eksik veya yanlış işlenmişse düzeltilmesini isteme,</li>
        <li>KVKK’nın 7. maddesindeki şartlar çerçevesinde silinmesini veya yok edilmesini isteme,</li>
        <li>düzeltme, silme ve yok etme işlemlerinin verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme,</li>
        <li>
          münhasıran otomatik sistemlerle analiz edilmesi sonucunda aleyhinize bir sonucun ortaya çıkmasına itiraz
          etme,
        </li>
        <li>kanuna aykırı işlenmesi sebebiyle zarara uğramanız halinde zararın giderilmesini talep etme</li>
      </ul>
      <p>haklarına sahipsiniz.</p>

      <h2>9. Başvuru yolu</h2>
      <p>
        Başvurunuzu, kimliğinizi doğrulayabilmemiz için ad soyad, iletişim bilgileriniz ve talebinizi içerecek
        şekilde:
      </p>
      <ul>
        <li>{c.address} adresine yazılı olarak,</li>
        <li>{c.kep} adresine kayıtlı elektronik posta (KEP), güvenli elektronik imza ya da mobil imza ile,</li>
        <li>Sitede kayıtlı e-posta adresinizden {c.email} adresine e-postayla</li>
      </ul>
      <p>
        iletebilirsiniz. Başvurunuz en geç 30 gün içinde ücretsiz olarak sonuçlandırılır; işlemin ayrıca bir maliyet
        gerektirmesi halinde Kişisel Verileri Koruma Kurulunca belirlenen tarifedeki ücret alınabilir. Başvurunuzun
        reddedilmesi, yanıtı yetersiz bulmanız ya da süresinde yanıt verilmemesi halinde Kişisel Verileri Koruma
        Kuruluna şikâyette bulunabilirsiniz.
      </p>
    </LegalPage>
  );
}
