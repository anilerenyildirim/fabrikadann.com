import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import { TOTP } from "otpauth";

config({ quiet: true });

/**
 * Üretici → ürün → mal alımı → ödeme → muhasebe akışı (yerel geliştirme veritabanını değiştirir).
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

test("üretici, alış fişi, ödeme ve muhasebe", async ({ page }) => {
  await login(page);
  const name = `E2E Atölye ${Date.now()}`;

  await page.goto("/yonetim/ureticiler/yeni");
  await checkLayout(page, "/yonetim/ureticiler/yeni");
  await page.getByLabel("Üretici adı").fill(name);
  await page.getByLabel("IBAN").fill("TR12 0006 2000 0000 0000 0000 01");
  await page.getByRole("button", { name: "Üreticiyi ekle" }).click();
  await page.waitForURL(/\/yonetim\/ureticiler\/[0-9a-f-]{36}$/);
  const manufacturerUrl = page.url();
  const manufacturerId = manufacturerUrl.split("/").pop()!;

  // Yeni ürün: üretici ve alış fiyatıyla, bir renk ve iki numara
  await page.goto("/yonetim/urunler/yeni");
  await checkLayout(page, "/yonetim/urunler/yeni");
  await page.getByLabel("Ürün adı").fill(`${name} Bot`);
  await page.getByLabel("Fiyat (TL, KDV dahil)").fill("1.500,00");
  await page.getByLabel("Üretici", { exact: true }).selectOption({ label: name });
  await page.getByLabel("Alış fiyatı (TL, çift başı)").fill("500,00");
  await page.getByRole("button", { name: "Ürünü oluştur" }).click();
  await page.waitForURL(/\/yonetim\/urunler\/[0-9a-f-]{36}\?yeni=1/);
  const productUrl = page.url().split("?")[0]!;
  await page.getByLabel("Yeni renk").fill("Siyah");
  await page.getByRole("button", { name: "Renk ekle" }).click();
  await page.getByLabel("Numara ekle — Siyah").fill("40-41");
  await page.getByRole("button", { name: "Numaraları ekle" }).click();
  await expect(page.locator("main").getByText(/29\d{11}/).first()).toBeVisible();
  await checkLayout(page, "ürün sayfası");

  // Barkod etiketleri
  await page.goto(`${productUrl}/etiket`);
  await expect(page.locator("main svg[aria-label^='Barkod 29']").first()).toBeVisible();
  const barcode = (await page.locator("main svg[aria-label^='Barkod 29']").first().getAttribute("aria-label"))!.replace("Barkod ", "");
  await checkLayout(page, "etiket");

  // Mal alımı: barkod okut + elle adet
  await page.goto(`/yonetim/muhasebe/fisler/yeni?uretici=${manufacturerId}`);
  await checkLayout(page, "fiş formu");
  const scan = page.getByLabel("Barkod okut");
  await scan.fill(barcode);
  await scan.press("Enter");
  await scan.fill(barcode);
  await scan.press("Enter");
  await expect(page.getByText(/: 2 adet$/)).toBeVisible();
  await page.getByRole("button", { name: "Alış fişini kaydet" }).click();
  await page.waitForURL(/\/yonetim\/muhasebe\/fisler\/[0-9a-f-]{36}\?yeni=1/);
  await expect(page.getByText("Fiş kaydedildi.", { exact: false })).toBeVisible();
  await expect(page.locator("main tfoot")).toContainText("1.000,00 TL");
  await checkLayout(page, "fiş");

  // Ödeme
  await page.goto(manufacturerUrl);
  await page.getByLabel("Tutar (TL)").fill("300,00");
  await page.getByRole("button", { name: "Ödemeyi kaydet" }).click();
  await expect(page.getByText("300,00 TL kaydedildi.")).toBeVisible();
  await page.reload();
  // 1.000 alış − 300 ödeme
  await expect(page.locator("main").getByText("700,00 TL").first()).toBeVisible();
  await checkLayout(page, "üretici");

  // Genel gider ve raporlar
  await page.goto("/yonetim/muhasebe/gelir-gider");
  await page.getByLabel("Kategori").selectOption("shipping");
  await page.getByLabel("Tutar (TL)").fill("45,50");
  await page.getByRole("button", { name: "Gideri kaydet" }).click();
  await expect(page.getByText("45,50 TL kaydedildi.")).toBeVisible();
  await checkLayout(page, "gelir-gider");

  for (const path of ["/yonetim/muhasebe", "/yonetim/muhasebe/fisler", "/yonetim/ureticiler"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await checkLayout(page, path);
  }
});
