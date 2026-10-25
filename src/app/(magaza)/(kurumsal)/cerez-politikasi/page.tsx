import type { Metadata } from "next";
import Link from "next/link";
import { LOCAL_STORAGE_ITEMS } from "@/components/legal/cookies";
import { LegalPage } from "@/components/legal/LegalPage";

// TASLAK: KVKK Çerez Uygulamaları Rehberi dikkate alınarak hazırlandı; hukukçu kontrolü gerekir.
// Çerez adları src/server/auth/current.ts, src/server/cart-owner.ts ve misafir sipariş erişimiyle aynı tutulmalı.

export const metadata: Metadata = {
  title: "Çerez politikası",
  description: "fabrikadann.com yalnızca sitenin çalışması için zorunlu çerezleri kullanır.",
  alternates: { canonical: "/cerez-politikasi" },
};

const COOKIES = [
  {
    name: "__Host-fd_oturum",
    purpose: "Giriş yaptığınızda oturumunuzu açık tutar.",
    duration: "30 gün (yönetici oturumlarında 12 saat) ya da çıkış yapana kadar",
  },
  {
    name: "__Host-fd_sepet",
    purpose: "Üye girişi yapmadan sepete eklediğiniz ürünleri hatırlar.",
    duration: "30 gün",
  },
  {
    name: "__Host-fd_siparisler",
    purpose: "Üye olmadan verdiğiniz siparişlerin sayfasını bu tarayıcıda görüntüleyebilmenizi sağlar.",
    duration: "30 gün",
  },
];

export default function CookiePolicyPage() {
  return (
    <LegalPage
      title="Çerez politikası"
      lead={<p>Sitemiz yalnızca çalışması için gerekli çerezleri kullanır. Analitik, reklam ya da pazarlama çerezi kullanmıyoruz.</p>}
    >
      <h2>Çerez nedir?</h2>
      <p>
        Çerezler, ziyaret ettiğiniz sitenin tarayıcınıza kaydettiği küçük metin dosyalarıdır. Site, sonraki
        isteklerde bu dosyaları okuyarak örneğin oturumunuzun açık olduğunu ya da sepetinizdeki ürünleri tanır.
      </p>

      <h2>Kullandığımız çerezler</h2>
      <p>
        Aşağıdaki çerezlerin tümü birinci taraf (yalnızca fabrikadann.com tarafından okunan) ve zorunlu çerezlerdir.
        Yalnızca güvenli (HTTPS) bağlantıda gönderilir, sayfadaki betikler tarafından okunamaz (HttpOnly) ve başka
        sitelerin arka planda yaptığı isteklere ya da gönderdiği formlara eklenmez; başka bir siteden bir bağlantıya
        tıklayarak fabrikadann.com’a geldiğinizde ise oturumunuzun açık kalması için gönderilir (SameSite=Lax).
      </p>
      <div className="mb-4 border-t border-rule text-[0.875rem]">
        {COOKIES.map((c) => (
          <dl key={c.name} className="grid gap-x-4 gap-y-1 border-b border-rule py-4 sm:grid-cols-[11rem_1fr]">
            <dt className="label pt-0.5 text-graphite">Çerez</dt>
            <dd className="min-w-0 break-all font-medium">{c.name}</dd>
            <dt className="label pt-0.5 text-graphite">Amaç</dt>
            <dd className="min-w-0">{c.purpose}</dd>
            <dt className="label pt-0.5 text-graphite">Süre</dt>
            <dd className="min-w-0">{c.duration}</dd>
            <dt className="label pt-0.5 text-graphite">Tür</dt>
            <dd className="min-w-0">Zorunlu, birinci taraf</dd>
          </dl>
        ))}
      </div>
      <p className="text-[0.8125rem] text-graphite">
        Test ortamında bu çerezler “__Host-” öneki olmadan (ör. fd_oturum) kullanılır.
      </p>

      <h2>Tarayıcı yerel depolaması</h2>
      <p>
        Bazı görünüm tercihleriniz çerez yerine tarayıcınızın yerel depolamasında tutulur. Bu kayıtlar sunucuya
        gönderilmez, sizi tanımlamak için kullanılmaz ve tarayıcınızın site verilerini temizleyerek silinebilir.
      </p>
      <ul>
        {LOCAL_STORAGE_ITEMS.map((item) => (
          <li key={item.key}>
            <strong className="break-all">{item.key}</strong>: {item.purpose}
          </li>
        ))}
      </ul>

      <h2>Hukuki sebep</h2>
      <p>
        Zorunlu çerezler, istediğiniz hizmetin (oturum, sepet, sipariş) sunulabilmesi için gereklidir ve KVKK’nın
        5. maddesinin 2. fıkrasının (c) bendi (sözleşmenin kurulması ve ifası) ile (f) bendi (meşru menfaat)
        kapsamında, açık rızanız aranmaksızın kullanılır. Ayrıntılar için{" "}
        <Link href="/kvkk">KVKK aydınlatma metnine</Link> bakın.
      </p>

      <h2>Analitik ve pazarlama çerezleri</h2>
      <p>
        Analitik, reklam, sosyal medya ya da pazarlama amaçlı çerez ve izleme pikseli kullanmıyoruz. İleride
        kullanmaya karar verirsek bu sayfayı güncelleyecek ve bu çerezleri yalnızca açık rızanızı aldıktan sonra
        etkinleştireceğiz.
      </p>

      <h2>Çerezleri nasıl yönetebilirsiniz?</h2>
      <p>
        Tarayıcınızın ayarlarından çerezleri silebilir ya da engelleyebilirsiniz. Zorunlu çerezleri engellerseniz
        giriş yapamaz ve sepete ürün ekleyemezsiniz; sitenin geri kalanı çalışmaya devam eder.
      </p>
    </LegalPage>
  );
}
