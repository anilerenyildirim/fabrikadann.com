import type { Metadata } from "next";
import Link from "next/link";
import { AccountHeader } from "@/components/account/AccountHeader";
import { DeleteAddressButton } from "@/components/account/DeleteAddressButton";
import { formatPhone } from "@/components/account/schemas";
import { ButtonLink, FormNotice } from "@/components/ui/form";
import { requireAccountUser } from "@/components/account/guard";
import { listAddresses, MAX_ADDRESSES } from "@/server/services/addresses";

export const metadata: Metadata = { title: "Adreslerim" };

// Yalnızca bilinen durum kodları gösterilir; parametredeki metin sayfaya yazılmaz
const NOTICES: Record<string, { tone: "info" | "error"; text: string }> = {
  eklendi: { tone: "info", text: "Adres kaydedildi." },
  guncellendi: { tone: "info", text: "Adres güncellendi." },
  silindi: { tone: "info", text: "Adres silindi." },
  silinemedi: { tone: "error", text: "Adres silinemedi. Sayfayı yenileyip yeniden deneyin." },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AddressesPage({ searchParams }: Props) {
  const user = await requireAccountUser("/hesabim/adresler");
  const [addresses, params] = await Promise.all([listAddresses(user.id), searchParams]);
  const notice = typeof params.durum === "string" ? NOTICES[params.durum] : undefined;
  const full = addresses.length >= MAX_ADDRESSES;

  return (
    <>
      <AccountHeader title="Adreslerim" back />
      {notice && (
        <div className="mb-8">
          <FormNotice tone={notice.tone}>{notice.text}</FormNotice>
        </div>
      )}

      {addresses.length === 0 ? (
        <div className="border-t border-rule pt-10">
          <p className="wide text-[0.8125rem]">Kayıtlı adresiniz yok</p>
          <p className="mt-3 max-w-md text-graphite">
            Bir adres kaydederseniz siparişte formu yeniden doldurmanız gerekmez.
          </p>
        </div>
      ) : (
        <ul className="grid border-t border-rule sm:grid-cols-2 sm:gap-x-10">
          {addresses.map((a) => (
            <li key={a.id} className="flex flex-col border-b border-rule py-6">
              <p className="label">{a.title}</p>
              <address className="mt-3 flex-1 text-[0.8125rem] not-italic leading-relaxed">
                {a.fullName}
                <br />
                <span className="break-words">{a.line}</span>
                <br />
                {a.district} / {a.city}
                <br />
                <span className="tabular">{formatPhone(a.phone)}</span>
              </address>
              <div className="mt-4 flex flex-wrap items-center gap-x-8">
                <Link
                  href={`/hesabim/adresler/${a.id}`}
                  className="label inline-flex min-h-11 items-center underline-offset-4 hover:underline"
                  aria-label={`${a.title} adresini düzenle`}
                >
                  Düzenle
                </Link>
                <DeleteAddressButton id={a.id} title={a.title} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10">
        {full ? (
          <p className="text-[0.8125rem] text-graphite">
            En fazla {MAX_ADDRESSES} adres kaydedebilirsiniz. Yeni adres eklemek için birini silin.
          </p>
        ) : (
          <ButtonLink href="/hesabim/adresler/yeni" className="w-full sm:w-auto">
            Yeni adres ekle
          </ButtonLink>
        )}
      </div>
    </>
  );
}
