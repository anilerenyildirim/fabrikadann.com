// Yönetim uygulaması (PWA) tanımı. Yalnızca /yonetim kapsamında; vitrin sayfalarında bağlantısı yok.
export const dynamic = "force-static";

const manifest = {
  id: "/yonetim",
  name: "Fabrikadann Yönetim",
  short_name: "Fabrikadann",
  description: "Sipariş, stok ve mağaza yönetimi",
  lang: "tr",
  start_url: "/yonetim",
  // "/yonetim" hem /yonetim hem /yonetim/... adreslerini kapsar; start_url kapsamın içinde olmalı
  scope: "/yonetim",
  display: "standalone",
  orientation: "portrait",
  background_color: "#ffffff",
  theme_color: "#000000",
  icons: [
    { src: "/yonetim/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/yonetim/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/yonetim/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export function GET() {
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
