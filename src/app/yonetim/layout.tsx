import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Yönetim", template: "%s — Yönetim · fabrikadann" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "same-origin",
  // Telefona "Fabrikadann Yönetim" uygulaması olarak eklenir (bildirimler için; iPhone'da ana ekrandan açılmalı)
  manifest: "/yonetim/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Fabrikadann", statusBarStyle: "default" },
  icons: { apple: "/yonetim/apple-touch-icon.png" },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
