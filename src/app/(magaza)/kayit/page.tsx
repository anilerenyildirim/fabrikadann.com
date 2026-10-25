import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountHeader } from "@/components/account/AccountHeader";
import { RegisterForm } from "@/components/account/RegisterForm";
import { returnPath } from "@/components/account/schemas";
import { getCurrentUser } from "@/server/auth/current";

export const metadata: Metadata = {
  title: "Hesap oluştur",
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function RegisterPage({ searchParams }: Props) {
  const params = await searchParams;
  const rawNext = typeof params.sonra === "string" ? params.sonra : undefined;
  const next = returnPath(rawNext);
  if (await getCurrentUser()) redirect(next);
  const carry = rawNext && next === rawNext ? next : undefined;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-10 md:px-6 md:pt-16">
      <AccountHeader title="Hesap oluştur">
        <p>Siparişlerinizi izlemek ve adreslerinizi kaydetmek için birkaç bilgi yeterli.</p>
      </AccountHeader>
      <RegisterForm returnTo={carry} />
      <p className="mt-10 border-t border-rule pt-6 text-[0.8125rem] text-graphite">
        Zaten hesabınız var mı?{" "}
        <Link
          href={carry ? `/giris?sonra=${encodeURIComponent(carry)}` : "/giris"}
          className="inline-flex min-h-11 items-center text-ink underline underline-offset-4"
        >
          Giriş yapın
        </Link>
      </p>
    </div>
  );
}
