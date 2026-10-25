import type { Metadata } from "next";

// Yetki kontrolü her sayfada ve her action'da ayrıca yapılır (requireAccountUser); düzen yalnızca çerçeve.
export const metadata: Metadata = {
  title: { default: "Hesabım", template: "%s — Hesabım — fabrikadann" },
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl px-4 pt-10 md:px-6 md:pt-16">{children}</div>;
}
