import type { Metadata } from "next";
import { AccountHeader } from "@/components/account/AccountHeader";
import { ResetPasswordForm } from "@/components/account/ResetPasswordForm";
import { isTokenFormat } from "@/components/account/schemas";
import { ButtonLink } from "@/components/ui/form";

export const metadata: Metadata = {
  title: "Yeni parola",
  // Bağlantıdaki token başka sitelere Referer ile gitmesin
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

export default async function ResetPasswordPage({ params }: Props) {
  const { token } = await params;

  if (!isTokenFormat(token)) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-10 md:px-6 md:pt-16">
        <AccountHeader title="Bağlantı geçersiz">
          <p>
            Bu parola sıfırlama bağlantısı geçersiz ya da eksik kopyalanmış. E-postadaki bağlantının tamamını
            kullanın ya da yeni bir bağlantı isteyin.
          </p>
        </AccountHeader>
        <ButtonLink href="/sifremi-unuttum" full className="sm:w-auto">
          Yeni bağlantı iste
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-10 md:px-6 md:pt-16">
      <AccountHeader title="Yeni parola">
        <p>Hesabınız için yeni bir parola belirleyin. Parolanız değişince açık oturumlarınızın tümü kapanır.</p>
      </AccountHeader>
      <ResetPasswordForm token={token} />
    </div>
  );
}
