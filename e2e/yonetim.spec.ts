import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import { TOTP } from "otpauth";

// Yerel .env (gitignore'da) değerleri
config({ quiet: true });

/**
 * Yönetim paneli sayfaları telefonda ve masaüstünde taşmıyor, dokunma hedefleri yeterli.
 * Yalnızca yerel geliştirme veritabanındaki bir yönetici hesabıyla çalışır:
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET (base32) — ortamdan ya da yerel .env'den
 * Tanımlı değilse atlanır.
 */
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;
const secret = process.env.E2E_ADMIN_TOTP_SECRET;

test.skip(!email || !password || !secret, "E2E_ADMIN_* tanımlı değil");
// Aynı TOTP adımı ikinci kez kabul edilmez: projeler sırayla çalışır, her giriş yeni adımı bekler
test.setTimeout(120_000);

const PAGES = ["/yonetim", "/yonetim/siparisler", "/yonetim/urunler", "/yonetim/kategoriler", "/yonetim/stok", "/yonetim/musteriler", "/yonetim/ayarlar", "/yonetim/gunluk"];

test("yönetim sayfaları: taşma yok, dokunma hedefleri yeterli", async ({ page }) => {
  await page.goto("/yonetim/giris");
  await page.fill("input[type=email]", email!);
  await page.fill("input[type=password]", password!);
  await page.click("button[type=submit]");
  await page.waitForURL(/iki-adim/);
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  await page.getByLabel("Doğrulama kodu").fill(new TOTP({ secret: secret! }).generate());
  await page.getByRole("button", { name: "Doğrula ve panele gir" }).click();
  await page.waitForURL(/\/yonetim$/);

  for (const path of PAGES) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path}: yatay kaydırma olmamalı`).toBeLessThanOrEqual(0);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main button, main summary, nav a, header a, main select")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.height < 43;
        })
        .map((el) => `${el.tagName} "${el.innerText.trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`),
    );
    expect(small, `${path}: 44px'ten küçük dokunma hedefleri`).toEqual([]);
  }
});
