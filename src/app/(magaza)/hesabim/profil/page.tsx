import type { Metadata } from "next";
import Link from "next/link";
import { AccountHeader } from "@/components/account/AccountHeader";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { ProfileForm } from "@/components/account/ProfileForm";
import { formatPhone } from "@/components/account/schemas";
import { requireAccountUser } from "@/components/account/guard";

export const metadata: Metadata = { title: "Profil ve parola" };

export default async function ProfilePage() {
  const user = await requireAccountUser("/hesabim/profil");

  return (
    <>
      <AccountHeader title="Profil ve parola" back />

      <section aria-labelledby="kisisel-bilgiler" className="border-t border-rule pt-8">
        <h2 id="kisisel-bilgiler" className="wide text-[0.8125rem] font-[450]">
          Kişisel bilgiler
        </h2>
        <dl className="mt-6">
          <dt className="label text-graphite">E-posta</dt>
          <dd className="mt-2 break-all">{user.email}</dd>
          <dd className="mt-1 text-[0.8125rem] text-graphite">
            E-posta adresinizi değiştirmek için{" "}
            <Link href="/iletisim" className="underline underline-offset-4">
              bize yazın
            </Link>
            .
          </dd>
        </dl>
        <div className="mt-8">
          <ProfileForm
            initial={{ firstName: user.firstName, lastName: user.lastName, phone: formatPhone(user.phone) }}
          />
        </div>
      </section>

      <section aria-labelledby="parola" className="mt-16 border-t border-rule pt-8">
        <h2 id="parola" className="wide text-[0.8125rem] font-[450]">
          Parola
        </h2>
        <p className="mt-3 max-w-md text-[0.8125rem] text-graphite">
          Parolanız değişince diğer cihazlardaki oturumlarınız kapanır; bu cihazda oturumunuz açık kalır.
        </p>
        <div className="mt-8">
          <ChangePasswordForm email={user.email} />
        </div>
      </section>
    </>
  );
}
