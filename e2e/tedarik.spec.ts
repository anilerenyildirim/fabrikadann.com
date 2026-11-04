import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { TOTP } from "otpauth";

config({ quiet: true });

/**
 * Toplu üretici ve alış fiyatı girişi (yerel geliştirme veritabanını değiştirir).
 * E2E_ADMIN_* tanımlı değilse atlanır; ayrıntı için yonetim.spec.ts.
 */
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;
const secret = process.env.E2E_ADMIN_TOTP_SECRET;

test.skip(!email || !password || !secret, "E2E_ADMIN_* tanımlı değil");
test.setTimeout(180_000);

async function login(page: Page) {
  await page.goto("/yonetim/giris");
  await page.fill("input[type=email]", email!);
  await page.fill("input[type=password]", password!);
  await page.click("button[type=submit]");
  await page.waitForURL(/iki-adim/);
  // Aynı TOTP adımı ikinci kez kabul edilmez
  await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  await page.getByLabel("Doğrulama kodu").fill(new TOTP({ secret: secret! }).generate());
  await page.getByRole("button", { name: "Doğrula ve panele gir" }).click();
  await page.waitForURL(/\/yonetim$/);
}

async function checkLayout(page: Page, path: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${path}: yatay kaydırma olmamalı`).toBeLessThanOrEqual(0);
  // Telefonda taşan öğe sayfayı uzaklaştırır: düzen genişliği ekran genişliğini aşmamalı
  const layoutWidth = await page.evaluate(() => window.innerWidth);
  expect(layoutWidth, `${path}: sayfa ekrandan geniş`).toBeLessThanOrEqual(page.viewportSize()!.width);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main button, main a, main select, main input:not([type=hidden]):not([type=checkbox])")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 43;
      })
      .map((el) => `${el.tagName} "${(el.innerText || el.getAttribute("aria-label") || el.getAttribute("name") || "").trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`),
  );
  expect(small, `${path}: 44px'ten küçük dokunma hedefleri`).toEqual([]);
}

test("ürünlere toplu üretici ve alış fiyatı", async ({ page }) => {
  await login(page);
  const name = `E2E Tedarik ${Date.now()}`;
  await page.goto("/yonetim/ureticiler/yeni");
  await page.getByLabel("Üretici adı").fill(name);
  await page.getByRole("button", { name: "Üreticiyi ekle" }).click();
  await page.waitForURL(/\/yonetim\/ureticiler\/[0-9a-f-]{36}$/);
  const manufacturerId = page.url().split("/").pop()!;

  await page.goto("/yonetim/urunler/tedarik");
  await checkLayout(page, "/yonetim/urunler/tedarik");
  const firstId = await page.locator('input[type=hidden][name="id"]').first().getAttribute("value");
  const select = page.locator(`select[name="m-${firstId}"]`);
  const locked = await select.isDisabled();

  // Hatalı fiyat: satır işaretlenir, hiçbir şey kaydedilmez
  await page.locator(`input[name="p-${firstId}"]`).fill("abc");
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(page.getByText("Alış fiyatını 850,00 biçiminde yazın ya da boş bırakın.")).toBeVisible();

  await page.locator(`input[name="p-${firstId}"]`).fill("812,50");
  if (!locked) await select.selectOption(manufacturerId);
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(page.getByText(/ürünün bilgisi kaydedildi|Değişiklik yok/)).toBeVisible();

  await page.reload();
  await expect(page.locator(`input[name="p-${firstId}"]`)).toHaveValue("812,50");
  if (!locked) await expect(page.locator(`select[name="m-${firstId}"]`)).toHaveValue(manufacturerId);
  await checkLayout(page, "/yonetim/urunler/tedarik (kayıttan sonra)");
});
