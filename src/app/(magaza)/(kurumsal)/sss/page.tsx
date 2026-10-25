import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { companyInfo, isFilled, shippingTerms } from "@/components/legal/company";
import { LegalPage } from "@/components/legal/LegalPage";
import { getSettings } from "@/server/services/settings";

export const metadata: Metadata = {
  title: "Sık sorulan sorular",
  description: "Kargo, iade, numara seçimi, ödeme ve sipariş takibi hakkında sık sorulan sorular.",
  alternates: { canonical: "/sss" },
};

export default async function FaqPage() {
  const settings = await getSettings();
  const c = companyInfo(settings);
  const mail = isFilled(c.email) ? <a href={`mailto:${c.email}`}>{c.email}</a> : c.email;

  const groups: { title: string; items: { q: string; a: ReactNode }[] }[] = [
    {
      title: "Sipariş ve kargo",
      items: [
        {
          q: "Siparişim ne zaman elime ulaşır?",
          a: (
            <p>
              Siparişiniz ödemeniz onaylandıktan sonra hazırlanıp kargoya verilir. Ortalama teslim süresi: [Ortalama
              teslim süresi — işletme tarafından belirlenecek]. Teslimat hiçbir durumda yasal süre olan 30 günü aşmaz.
            </p>
          ),
        },
        {
          q: "Kargo ücreti ne kadar?",
          a: (
            <p>
              {shippingTerms(settings)} Kargo ücreti varsa ödeme adımındaki sipariş özetinde ayrıca gösterilir.
            </p>
          ),
        },
        {
          q: "Siparişimi nasıl takip ederim?",
          a: (
            <p>
              Üye girişiyle verdiğiniz siparişlerin durumu ve kargo takip numarası{" "}
              <Link href="/hesabim/siparisler">Hesabım › Siparişlerim</Link> sayfasında görünür. Üye olmadan
              verdiğiniz siparişin sayfasını, siparişi verdiğiniz tarayıcıdan açabilirsiniz; sipariş numaranızla bize
              yazarak da durumunu öğrenebilirsiniz.
            </p>
          ),
        },
        {
          q: "Üye olmadan sipariş verebilir miyim?",
          a: (
            <p>
              Evet. Ödeme adımında e-posta adresinizi ve teslimat bilgilerinizi girmeniz yeterli. Hesap oluşturursanız
              siparişlerinizi tek yerden izler, adreslerinizi kaydedersiniz.
            </p>
          ),
        },
        {
          q: "Siparişimi iptal edebilir miyim?",
          a: (
            <p>
              Siparişiniz kargoya verilmeden önce sipariş numaranızla {mail} adresine yazın. Kargoya verilmiş
              siparişlerde ürünü teslim aldıktan sonra iade edebilirsiniz.
            </p>
          ),
        },
      ],
    },
    {
      title: "Numara ve ürün",
      items: [
        {
          q: "Hangi numarayı seçmeliyim?",
          a: (
            <p>
              Ürün sayfalarındaki numaralar standart Avrupa (EU) numaralarıdır. Günlük giydiğiniz numarayı seçin; iki
              numara arasında kalıyorsanız ürün açıklamasındaki kalıp bilgisine bakın ya da bize yazın. Numara
              olmazsa 14 gün içinde değişim isteyebilirsiniz.
            </p>
          ),
        },
        {
          q: "Stokta olmayan numara tekrar gelir mi?",
          a: (
            <p>
              Stokta olmayan numaralar ürün sayfasında seçilemez görünür. Stok yenilendiğinde yeniden satışa açılır;
              belirli bir numarayı soruyorsanız bize yazın.
            </p>
          ),
        },
      ],
    },
    {
      title: "Ödeme",
      items: [
        {
          q: "Hangi ödeme yöntemlerini kabul ediyorsunuz?",
          a: (
            <p>
              Kredi kartı ve banka kartıyla ödeme yapabilirsiniz. Ödemeler lisanslı ödeme kuruluşu iyzico güvencesiyle
              alınır; kart bilgileriniz bize ulaşmaz ve saklanmaz.
            </p>
          ),
        },
        {
          q: "Fiyatlara KDV dahil mi?",
          a: <p>Evet, sitedeki tüm fiyatlar KDV dahildir. Kargo ücreti varsa sipariş özetinde ayrıca gösterilir.</p>,
        },
      ],
    },
    {
      title: "İade ve değişim",
      items: [
        {
          q: "İade nasıl yapılır?",
          a: (
            <p>
              Ürünü teslim aldığınız günden itibaren 14 gün içinde sipariş numaranızla bize yazın, ürünü kutusuyla
              birlikte gönderin. Ödediğiniz tutar, bildiriminizden itibaren 14 gün içinde kartınıza iade edilir.
              Adımlar için <Link href="/iade-degisim">İade ve değişim</Link> sayfasına bakın.
            </p>
          ),
        },
        {
          q: "Numara değişimi yapabilir miyim?",
          a: (
            <p>
              Evet, stokta varsa. 14 gün içinde istediğiniz numarayı belirterek bize yazın. En hızlısı, istediğiniz
              numarayı yeni bir siparişle almak ve elinizdekini iade etmektir.
            </p>
          ),
        },
      ],
    },
    {
      title: "fabrikadann",
      items: [
        {
          q: "Trendyol mağazanızdan farkı ne?",
          a: (
            <p>
              Aynı ürünleri Trendyol mağazamızda da satıyoruz. Bu sitede pazar yeri komisyonu olmadığı için aynı
              ürünler daha uygun fiyatlı. Stoklarımız ortaktır: bir numara bir kanalda tükenirse diğerinde de tükenir.
            </p>
          ),
        },
        {
          q: "Size nasıl ulaşırım?",
          a: (
            <p>
              {mail} adresine yazabilir ya da <Link href="/iletisim">İletişim</Link> sayfasındaki diğer yolları
              kullanabilirsiniz.
            </p>
          ),
        },
      ],
    },
  ];

  return (
    <LegalPage title="Sık sorulan sorular" updated={false}>
      {groups.map((g) => (
        <section key={g.title}>
          <h2>{g.title}</h2>
          <div className="border-t border-rule">
            {g.items.map((item) => (
              <details key={item.q} className="group border-b border-rule">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="flex-1 font-[450]">{item.q}</span>
                  <svg
                    viewBox="0 0 16 16"
                    className="size-3.5 shrink-0 transition-transform duration-200 group-open:rotate-45"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    aria-hidden="true"
                  >
                    <path d="M8 2v12M2 8h12" />
                  </svg>
                </summary>
                <div className="pb-3 pr-8 text-graphite">{item.a}</div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </LegalPage>
  );
}
