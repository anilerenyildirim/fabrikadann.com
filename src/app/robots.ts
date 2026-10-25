import type { MetadataRoute } from "next";

// Adres derleme anında değil, çalışırken APP_URL'den okunur
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/yonetim", "/hesabim", "/odeme", "/sepet", "/siparis", "/api"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
