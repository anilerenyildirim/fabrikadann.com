import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { AuthShell } from "@/components/admin/AuthShell";
import { getSession } from "@/server/auth/current";

export const metadata: Metadata = { title: "Giriş" };

export default async function AdminLoginPage() {
  const session = await getSession();
  if (session?.user.role === "admin") redirect(session.secondFactor ? "/yonetim" : "/yonetim/iki-adim");
  return (
    <AuthShell
      step="1 / 2"
      title="Giriş"
      footer="Yalnızca mağaza yöneticileri içindir. Hesap ve iki adımlı doğrulama scripts/create-admin.ts ile kurulur."
    >
      <AdminLoginForm />
    </AuthShell>
  );
}
