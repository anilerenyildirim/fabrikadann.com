import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "fabrikadann — Fabrikadan, aracısız ayakkabı",
    template: "%s — fabrikadann",
  },
  description: "fabrikadann: ayakkabılar üreticiden doğrudan size. Sitemizde, diğer satış kanallarımızdan daha uygun fiyatla.",
  openGraph: { siteName: "fabrikadann", locale: "tr_TR", type: "website" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Her sayfa istekte render edilir: CSP nonce'u ancak böyle script etiketlerine eklenebilir
  await connection();
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
