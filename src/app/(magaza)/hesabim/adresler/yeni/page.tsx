import type { Metadata } from "next";
import { AccountHeader } from "@/components/account/AccountHeader";
import { AddressForm } from "@/components/account/AddressForm";
import { requireAccountUser } from "@/components/account/guard";
import { formatPhone } from "@/components/account/schemas";
import { ButtonLink } from "@/components/ui/form";
import { listAddresses, MAX_ADDRESSES } from "@/server/services/addresses";

export const metadata: Metadata = { title: "Yeni adres" };

export default async function NewAddressPage() {
  const user = await requireAccountUser("/hesabim/adresler/yeni");
  const addresses = await listAddresses(user.id);

  // Sınır serviste de denetlenir; burada yalnızca formu boşuna doldurtmamak için
  if (addresses.length >= MAX_ADDRESSES) {
    return (
      <>
        <AccountHeader title="Yeni adres" back>
          <p>En fazla {MAX_ADDRESSES} adres kaydedebilirsiniz. Yeni adres eklemek için önce kayıtlı adreslerinizden birini silin.</p>
        </AccountHeader>
        <ButtonLink href="/hesabim/adresler" className="w-full sm:w-auto">
          Adreslerime dön
        </ButtonLink>
      </>
    );
  }

  return (
    <>
      <AccountHeader title="Yeni adres" back />
      <AddressForm
        initial={{ fullName: `${user.firstName} ${user.lastName}`.trim(), phone: formatPhone(user.phone) }}
      />
    </>
  );
}
