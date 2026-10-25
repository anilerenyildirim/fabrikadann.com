import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "yatay kaydırma olmamalı").toBeLessThanOrEqual(0);
}

/** Görünür buton ve başlık/menü bağlantılarının dokunma yüksekliği en az 44px (1px yuvarlama payıyla). */
async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>("button, header a, nav a, [role=button], select, input[type=checkbox]")];
    return els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && !el.closest("[inert]");
      })
      .filter((el) => {
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
          // Onay kutusunu saran etiket dokunma alanıdır
          const label = el.closest("label");
          return (label?.getBoundingClientRect().height ?? 0) < 43;
        }
        return el.getBoundingClientRect().height < 43;
      })
      .map((el) => `${el.tagName} "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`);
  });
  expect(small, "44px'ten küçük dokunma hedefleri").toEqual([]);
}

for (const path of ["/", "/urunler", "/kategori/sneaker", "/ara?q=bot", "/sepet", "/giris", "/kayit", "/sss"]) {
  test(`${path}: taşma yok, dokunma hedefleri yeterli`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBeLessThan(400);
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });
}

test("ürün sayfası: taşma yok, dokunma hedefleri yeterli", async ({ page }) => {
  await page.goto("/urunler");
  await page.locator("main a[href^='/urun/']").first().click();
  await expect(page).toHaveURL(/\/urun\//);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
});

test("misafir olarak satın alma (test ödemesi)", async ({ page }) => {
  await page.goto("/urunler");
  await page.locator("main a[href^='/urun/']").first().click();
  // Numaralar radyo düğmesi; tıklanan, onu saran etiket
  await page.locator("label:has(input[name=variantId]:enabled)").first().click();
  await page.getByRole("button", { name: "Sepete ekle" }).filter({ visible: true }).first().click();
  await expect(page.getByText("Sepete eklendi").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Sepet, 1 ürün" })).toBeVisible();

  await page.goto("/sepet");
  await page.getByRole("link", { name: /Ödemeye geç/ }).or(page.getByRole("button", { name: /Ödemeye geç/ })).first().click();
  await expect(page).toHaveURL(/\/odeme/);

  // Her çalıştırmada farklı e-posta: kişi başına açık sipariş sınırına takılmasın
  await page.getByLabel("E-posta", { exact: true }).fill(`e2e-${Date.now()}@ornek.com`);
  await page.getByLabel("Ad soyad", { exact: true }).fill("Deneme Müşteri");
  await page.getByLabel("Telefon", { exact: true }).fill("05551112233");
  await page.getByLabel("İl", { exact: true }).selectOption("İstanbul");
  await page.getByLabel("İlçe", { exact: true }).fill("Kadıköy");
  await page.getByLabel("Adres", { exact: true }).fill("Moda Caddesi No 1 Daire 2");
  await page.getByRole("checkbox").last().check();
  await page.getByRole("button", { name: /Siparişi onayla/ }).click();

  await expect(page.getByText(/TEST ÖDEMESİ/i)).toBeVisible();
  await page.getByRole("button", { name: "Ödeme başarılı" }).click();
  await expect(page).toHaveURL(/\/siparis\/FD[A-Z2-9]{8}/);
  await expect(page.getByText(/Hazırlanıyor/).first()).toBeVisible();
});

test("yönetim paneli girişsiz açılmaz", async ({ page }) => {
  await page.goto("/yonetim");
  await expect(page).toHaveURL(/\/yonetim\/giris/);
});
