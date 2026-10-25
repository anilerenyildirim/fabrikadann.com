import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@node-rs/argon2", "sharp"],
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default config;
