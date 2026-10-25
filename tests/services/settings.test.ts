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
