import Link from "next/link";
import { Wordmark } from "@/components/brand/Logo";
import type { Settings } from "@/server/services/settings";

const HELP = [
  { href: "/sss", label: "Sık sorulan sorular" },
  { href: "/iade-degisim", label: "İade ve değişim" },
  { href: "/hesabim/siparisler", label: "Sipariş takibi" },
  { href: "/iletisim", label: "İletişim" },
];

const LEGAL = [
  { href: "/hakkimizda", label: "Hakkımızda" },
  { href: "/kvkk", label: "KVKK aydınlatma metni" },
  { href: "/cerez-politikasi", label: "Çerez politikası" },
  { href: "/mesafeli-satis", label: "Mesafeli satış sözleşmesi" },
  { href: "/on-bilgilendirme", label: "Ön bilgilendirme formu" },
];

export function SiteFooter({ settings }: { settings: Settings }) {
  const social = [
    settings.instagramUrl && { href: settings.instagramUrl, label: "Instagram" },
    settings.trendyolUrl && { href: settings.trendyolUrl, label: "Trendyol mağazamız" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <footer className="mt-24 border-t border-rule px-4 pb-8 pt-12 md:px-6">
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <FooterColumn title="Yardım" links={HELP} />
        <FooterColumn title="Kurumsal" links={LEGAL} />
        {social.length > 0 && <FooterColumn title="Bizi takip edin" links={social} external />}
        <div>
          <h2 className="label mb-3 text-graphite">Fabrikadan, aracısız</h2>
          <p className="max-w-xs text-[0.8125rem] leading-relaxed text-graphite">
            Ayakkabılarımızı üreticiden doğrudan size gönderiyoruz. Bu sitedeki fiyatlar, aynı ürünlerin diğer
            satış kanallarımızdaki fiyatlarından düşüktür.
          </p>
        </div>
      </div>
      <Wordmark className="mt-16 h-auto w-full text-ink" title="fabrikadann" />
      <p className="label mt-6 text-ash">
        © {new Date().getFullYear()} {settings.companyName || "fabrikadann"}
      </p>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
  external = false,
}: {
  title: string;
  links: { href: string; label: string }[];
  external?: boolean;
}) {
  return (
    <div>
      <h2 className="label mb-2 text-graphite">{title}</h2>
      <ul>
        {links.map((l) => (
          <li key={l.href}>
            {external ? (
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-10 items-center text-[0.8125rem] hover:underline hover:underline-offset-4"
              >
                {l.label}
              </a>
            ) : (
              <Link
                href={l.href}
                className="flex min-h-10 items-center text-[0.8125rem] hover:underline hover:underline-offset-4"
              >
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
