import type { Metadata } from "next";
import Link from "next/link";
import { companyInfo, isFilled, telHref } from "@/components/legal/company";
import { CompanyDetails, LegalPage } from "@/components/legal/LegalPage";
import { getSettings } from "@/server/services/settings";

export const metadata: Metadata = {
  title: "İletişim",
  description: "fabrikadann'a ulaşın: e-posta, telefon ve adres.",
  alternates: { canonical: "/iletisim" },
};

export default async function ContactPage() {
  const settings = await getSettings();
  const c = companyInfo(settings);

  return (
    <LegalPage
      title="İletişim"
      updated={false}
      lead={
        <p>
          Siparişiniz, iade ya da değişim için yazarken sipariş numaranızı da ekleyin; böylece size daha hızlı
          yardımcı olabiliriz.
        </p>
      }
    >
      <div className="mb-12 grid gap-8 sm:grid-cols-2">
        <ContactItem label="E-posta">
          {isFilled(c.email) ? (
            <a href={`mailto:${c.email}`} className="inline-flex min-h-11 items-center break-all">
              {c.email}
            </a>
          ) : (
            c.email
          )}
        </ContactItem>
        <ContactItem label="Telefon">
          {isFilled(c.phone) ? (
            <a href={telHref(c.phone)} className="tabular inline-flex min-h-11 items-center">
              {c.phone}
            </a>
          ) : (
            c.phone
          )}
        </ContactItem>
        <ContactItem label="Adres" className="sm:col-span-2">
          <address className="not-italic">{c.address}</address>
        </ContactItem>
        {/^https:\/\//i.test(settings.instagramUrl) && (
          <ContactItem label="Instagram">
            <a
              href={settings.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center break-all"
            >
              {settings.instagramUrl.replace(/^https?:\/\/(www\.)?/, "")}
              <span className="sr-only"> (yeni sekmede açılır)</span>
            </a>
          </ContactItem>
        )}
      </div>

      <h2>Şirket bilgileri</h2>
      <CompanyDetails company={c} include={["name", "address", "kep", "taxOffice", "taxNumber", "mersis"]} />

      <h2>İade ve şikâyet</h2>
      <p>
        İade ve değişim adımları için <Link href="/iade-degisim">İade ve değişim</Link> sayfasına bakın. Çözüme
        ulaşamadığımız bir uyuşmazlıkta Tüketici Hakem Heyetine ya da Tüketici Mahkemesine başvurabilirsiniz.
      </p>
    </LegalPage>
  );
}

function ContactItem({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <p className="label mb-1 text-graphite">{label}</p>
      <div className="text-[0.9375rem]">{children}</div>
    </div>
  );
}
