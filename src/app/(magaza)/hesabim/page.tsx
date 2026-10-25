import Link from "next/link";
import { logoutAction } from "@/app/(magaza)/actions/auth";
import { AccountHeader } from "@/components/account/AccountHeader";
import { Button } from "@/components/ui/form";
import { requireAccountUser } from "@/components/account/guard";

const SECTIONS = [
  { href: "/hesabim/siparisler", title: "Siparişlerim", text: "Siparişlerinizin durumu ve kargo takibi" },
  { href: "/hesabim/adresler", title: "Adreslerim", text: "Kayıtlı teslimat adresleriniz" },
  { href: "/hesabim/profil", title: "Profil ve parola", text: "Ad, soyad, telefon ve parola" },
];

export default async function AccountPage() {
  const user = await requireAccountUser("/hesabim");

  return (
    <>
      <AccountHeader title="Hesabım">
        <p className="text-ink">Merhaba {user.firstName}.</p>
        <p className="mt-1 break-all">{user.email}</p>
      </AccountHeader>

      <nav aria-label="Hesap bölümleri">
        <ul className="border-t border-rule">
          {SECTIONS.map((s) => (
            <li key={s.href} className="border-b border-rule">
              <Link href={s.href} className="group flex min-h-11 items-center gap-4 py-5">
                <span className="flex-1">
                  <span className="wide block text-[0.8125rem] font-[450] group-hover:underline group-hover:underline-offset-4">
                    {s.title}
                  </span>
                  <span className="mt-1 block text-[0.8125rem] text-graphite">{s.text}</span>
                </span>
                <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                  <path d="M6 3l5 5-5 5" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form action={logoutAction} className="mt-10">
        <Button type="submit" variant="secondary" className="w-full sm:w-auto">
          Çıkış yap
        </Button>
      </form>
    </>
  );
}
