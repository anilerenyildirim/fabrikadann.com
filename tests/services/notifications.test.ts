import { beforeEach, expect, test } from "vitest";
import { db, schema } from "@/server/db";
import { enqueueNotification } from "@/server/notifications/outbox";
import { noteStockDrop } from "@/server/notifications/stock-alert";
import { updateSettings } from "@/server/services/settings";
import { makeProduct, resetDb } from "../helpers/db";

beforeEach(resetDb);

const base = { kind: "order_new" as const, source: "site" as const, title: "Yeni sipariş", body: "1 ürün", url: "/yonetim/siparisler" };

const all = () => db.select().from(schema.notifications);

test("aynı dedupe anahtarı ikinci kez yazılmaz", async () => {
  expect(await enqueueNotification(db, { ...base, dedupeKey: "site:order:FD-1" })).toBe(true);
  expect(await enqueueNotification(db, { ...base, dedupeKey: "site:order:FD-1", title: "başka" })).toBe(false);
  const rows = await all();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.title).toBe("Yeni sipariş");
});

test("/yonetim dışı adres reddedilir", async () => {
  await expect(enqueueNotification(db, { ...base, url: "https://kotu.example/x", dedupeKey: "a" })).rejects.toThrow();
  await expect(enqueueNotification(db, { ...base, url: "/hesabim", dedupeKey: "b" })).rejects.toThrow();
  await expect(enqueueNotification(db, { ...base, url: "/yonetimx", dedupeKey: "c" })).rejects.toThrow();
});

async function drop(variantId: string, before: number, after: number, reference = "FD-1") {
  await db.transaction((tx) => noteStockDrop(tx, { variantId, before, after, reference, source: "site" }));
}

test("eşik 1: 3→1 stok azaldı bildirimi", async () => {
  const { product, variants } = await makeProduct({ name: "Bot", sizes: [{ size: "38", stock: 1 }] });
  await drop(variants[0]!.id, 3, 1);
  const [n] = await all();
  expect(n!.kind).toBe("stock_low");
  expect(n!.title).toBe("Stok azaldı");
  expect(n!.body).toBe("Bot Siyah 38: 1");
  expect(n!.url).toBe(`/yonetim/urunler/${product.id}`);
  expect(n!.dedupeKey).toBe("stock:FD-1");
});

test("1→0 stok tükendi bildirimi", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "38", stock: 0 }] });
  await drop(variants[0]!.id, 1, 0);
  const [n] = await all();
  expect(n!.kind).toBe("stock_out");
  expect(n!.title).toBe("Stok tükendi");
});

test("eşik 1: 5→4 bildirim yok", async () => {
  const { variants } = await makeProduct();
  await drop(variants[0]!.id, 5, 4);
  expect(await all()).toHaveLength(0);
});

test("eşik zaten altındaysa yeniden azaldı bildirimi yok (2→1, eşik 2)", async () => {
  await updateSettings({ stockAlertThreshold: 2 });
  const { variants } = await makeProduct();
  await drop(variants[0]!.id, 2, 1);
  expect(await all()).toHaveLength(0);
});

test("eşik 0: yalnızca tükenince", async () => {
  await updateSettings({ stockAlertThreshold: 0 });
  const { variants } = await makeProduct();
  await drop(variants[0]!.id, 3, 1);
  expect(await all()).toHaveLength(0);
  await drop(variants[0]!.id, 1, 0, "FD-2");
  expect((await all())[0]!.kind).toBe("stock_out");
});

test("aynı siparişte iki numara tek bildirim; biri tükendiyse tükendi", async () => {
  const a = await makeProduct({ name: "Bot", sizes: [{ size: "38", stock: 1 }] });
  const b = await makeProduct({ name: "Babet", sizes: [{ size: "37", stock: 0 }] });
  await db.transaction(async (tx) => {
    await noteStockDrop(tx, { variantId: a.variants[0]!.id, before: 2, after: 1, reference: "FD-9", source: "site" });
    await noteStockDrop(tx, { variantId: b.variants[0]!.id, before: 1, after: 0, reference: "FD-9", source: "site" });
  });
  const rows = await all();
  expect(rows).toHaveLength(1);
  expect(rows[0]!.kind).toBe("stock_out");
  expect(rows[0]!.body).toBe("Bot Siyah 38: 1 · Babet Siyah 37: 0");
  expect(rows[0]!.url).toBe("/yonetim/stok");
});
