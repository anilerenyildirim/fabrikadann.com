import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountHeader } from "@/components/account/AccountHeader";
import { AddressForm } from "@/components/account/AddressForm";
import { formatPhone, idSchema } from "@/components/account/schemas";
import { requireAccountUser } from "@/components/account/guard";
import { getAddress } from "@/server/services/addresses";

export const metadata: Metadata = { title: "Adresi düzenle" };

type Props = { params: Promise<{ id: string }> };

export default async function EditAddressPage({ params }: Props) {
  const { id } = await params;
  const user = await requireAccountUser("/hesabim/adresler");
  if (!idSchema.safeParse(id).success) notFound();
  // Yalnızca sahibinin adresi döner; başkasının adresi için de 404
  const address = await getAddress(user.id, id);
  if (!address) notFound();

  return (
    <>
      <AccountHeader title="Adresi düzenle" back />
      <AddressForm
        id={address.id}
        initial={{
          title: address.title,
          fullName: address.fullName,
          phone: formatPhone(address.phone),
          city: address.city,
          district: address.district,
          line: address.line,
        }}
      />
    </>
  );
}
