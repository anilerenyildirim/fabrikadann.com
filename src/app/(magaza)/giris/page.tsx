import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountHeader } from "@/components/account/AccountHeader";
import { LoginForm } from "@/components/account/LoginForm";
import { returnPath } from "@/components/account/schemas";
import { ButtonLink, FormNotice } from "@/components/ui/form";
import { getCurrentUser } from "@/server/auth/current";

export const metadata: Metadata = {
  title: "Giriş yap",
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const rawNext = typeof params.sonra === "string" ? params.sonra : undefined;
  const next = returnPath(rawNext);
  if (await getCurrentUser()) redirect(next);

  // Yalnızca site içi, süzülmüş dönüş adresi forma ve kayıt bağlantısına taşınır
  const carry = rawNext && next === rawNext ? next : undefined;
  const fromCheckout = carry?.startsWith("/odeme") ?? false;
  const reset = params.sifirlandi === "1";

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-16 px-4 pt-10 md:grid-cols-2 md:gap-24 md:px-6 md:pt-16">
      <section>
        <AccountHeader title="Giriş yap" />
        <div className="flex flex-col gap-6">
          {reset && <FormNotice tone="info">Parolanız değişti, yeni parolanızla giriş yapın.</FormNotice>}
          <LoginForm returnTo={carry} />
        </div>
      </section>

      <section className="border-t border-rule pt-10 md:border-t-0 md:pt-0" aria-labelledby="kayit-baslik">
        <h2 id="kayit-baslik" className="wide text-[0.9375rem] font-[350]">
          Hesabınız yok mu?
        </h2>
        <p className="mt-4 max-w-sm text-graphite">
          Hesap oluşturun; siparişlerinizi ve kargo durumunu buradan izleyin, adreslerinizi bir sonraki alışverişiniz
          için kaydedin.
        </p>
        <ButtonLink
          href={carry ? `/kayit?sonra=${encodeURIComponent(carry)}` : "/kayit"}
          variant="secondary"
          full
          className="mt-8"
        >
          Hesap oluştur
        </ButtonLink>
        {fromCheckout && (
          <>
            <p className="mt-10 max-w-sm text-graphite">Üye olmadan da sipariş verebilirsiniz.</p>
            <ButtonLink href="/odeme" variant="quiet" className="mt-2">
              Üye olmadan devam et
            </ButtonLink>
          </>
        )}
      </section>
    </div>
  );
}
