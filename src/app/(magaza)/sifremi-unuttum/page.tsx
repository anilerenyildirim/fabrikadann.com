import type { Metadata } from "next";
import Link from "next/link";
import { AccountHeader } from "@/components/account/AccountHeader";
import { ForgotPasswordForm } from "@/components/account/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Parolamı unuttum",
  robots: { index: false, follow: true },
};

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-10 md:px-6 md:pt-16">
      <AccountHeader title="Parolamı unuttum">
        <p>Hesabınızın e-posta adresini yazın; parolanızı yenilemeniz için bir bağlantı gönderelim.</p>
      </AccountHeader>
      <ForgotPasswordForm />
      <p className="mt-10 border-t border-rule pt-6 text-[0.8125rem] text-graphite">
        Parolanızı hatırladınız mı?{" "}
        <Link href="/giris" className="inline-flex min-h-11 items-center text-ink underline underline-offset-4">
          Giriş yapın
        </Link>
      </p>
    </div>
  );
}
