import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/admin/AuthShell";
import { TotpForm } from "@/components/admin/TotpForm";
import { getSession } from "@/server/auth/current";
import { abandonLoginAction } from "./actions";

export const metadata: Metadata = { title: "İki adımlı doğrulama" };

export default async function AdminTotpPage() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") redirect("/yonetim/giris");
  if (session.secondFactor) redirect("/yonetim");
  return (
    <AuthShell
      step="2 / 2"
      title="İki adımlı doğrulama"
      footer={
        <form action={abandonLoginAction}>
          <span>{session.user.email} olarak devam ediyorsunuz. </span>
          <button type="submit" className="inline-flex min-h-11 items-center text-ink underline underline-offset-4 hover:no-underline">
            Başka hesapla gir
          </button>
        </form>
      }
    >
      <TotpForm />
    </AuthShell>
  );
}
