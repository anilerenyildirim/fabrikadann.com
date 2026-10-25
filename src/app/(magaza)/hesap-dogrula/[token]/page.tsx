import type { Metadata } from "next";
import { VerifyEmailForm } from "@/components/account/VerifyEmailForm";

export const metadata: Metadata = {
  title: "Hesabı etkinleştir",
  robots: { index: false, follow: false },
  // Bağlantıdaki token başka sitelere Referer ile gitmesin
  referrer: "no-referrer",
};

/**
 * E-postadaki doğrulama bağlantısı. Token sayfa açılınca DEĞİL, butona basılınca tüketilir:
 * e-posta güvenlik tarayıcıları bağlantıları önceden açtığında bağlantı boşa harcanmasın.
 */
export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-md px-4 pb-16 pt-12 md:pt-20">
      <h1 className="wide text-[1.125rem] font-[350]">Hesabı etkinleştir</h1>
      <p className="mt-3 text-[0.9375rem] text-graphite">
        E-posta adresinizi doğrulamak ve hesabınızı etkinleştirmek için butona dokunun.
      </p>
      <div className="mt-8">
        <VerifyEmailForm token={token.slice(0, 100)} />
      </div>
    </div>
  );
}
