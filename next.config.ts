import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@node-rs/argon2", "sharp"],
  output: "standalone",
  // Yüklenen görseller, testler ve belgeler canlı pakete (izlemeye) girmesin
  outputFileTracingExcludes: {
    "/*": ["./uploads/**/*", "./tests/**/*", "./e2e/**/*", "./docs/**/*", "./brand/**/*", "./test-results/**/*"],
  },
  // next/image kullanılmıyor; /_next/image optimize edicisi kapalı
  images: { unoptimized: true },
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
    // Proxy gövdeyi varsayılan 10 MB'ta keser; görsel yüklemesi (10 MB + form alanları) sığsın
    proxyClientMaxBodySize: "12mb",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
