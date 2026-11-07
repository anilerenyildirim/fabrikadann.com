import { beforeEach, expect, test } from "vitest";
import { defaultSettings, getSettings, updateSettings } from "@/server/services/settings";
import { resetDb } from "../helpers/db";

beforeEach(resetDb);

test("ayar yoksa varsayılanlar döner, güncelleme kalıcıdır", async () => {
  expect(await getSettings()).toEqual(defaultSettings);
  await updateSettings({ shippingFee: 0 });
  expect((await getSettings()).shippingFee).toBe(0);
});

test("geçersiz ayar reddedilir", async () => {
  await expect(updateSettings({ shippingFee: -1 })).rejects.toThrow();
});

test("stok uyarı eşiği varsayılanı 1, 101 reddedilir", async () => {
  expect((await getSettings()).stockAlertThreshold).toBe(1);
  await expect(updateSettings({ stockAlertThreshold: 101 })).rejects.toThrow();
});

test("N11 ayar varsayılanları; KDV yalnızca 0/1/10/20", async () => {
  const s = await getSettings();
  expect(s).toMatchObject({ n11PricePercent: 33, n11PreparingDay: 2, n11VatRate: 10, n11ShipmentTemplate: "", n11Brand: "Fabrikadann" });
  await expect(updateSettings({ n11VatRate: 18 as never })).rejects.toThrow();
  await updateSettings({ n11VatRate: 20 });
  expect((await getSettings()).n11VatRate).toBe(20);
});
