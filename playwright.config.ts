import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    // Sistemdeki Chrome kullanılır; ayrıca tarayıcı indirilmez
    channel: "chrome",
    locale: "tr-TR",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobil", use: { ...devices["Pixel 7"], channel: "chrome" } },
    { name: "masaustu", use: { viewport: { width: 1440, height: 900 }, channel: "chrome" } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
