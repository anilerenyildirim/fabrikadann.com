import type { Metadata } from "next";
import { ManufacturerForm } from "@/components/admin/ManufacturerForm";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { createManufacturerAction } from "../actions";

export const metadata: Metadata = { title: "Yeni üretici" };

export default async function NewManufacturerPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        title="Yeni üretici"
        back={{ href: "/yonetim/ureticiler", label: "Üreticiler" }}
        description="Yalnızca ad zorunlu. Diğer bilgileri sonra da girebilirsiniz."
      />
      <ManufacturerForm
        action={createManufacturerAction}
        initial={{
          name: "",
          contactName: "",
          phone: "",
          email: "",
          taxOffice: "",
          taxNumber: "",
          address: "",
          iban: "",
          note: "",
          openingBalance: "",
          active: true,
        }}
      />
    </>
  );
}
