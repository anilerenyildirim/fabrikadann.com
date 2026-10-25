import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Yönetim", template: "%s — Yönetim · fabrikadann" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "same-origin",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
