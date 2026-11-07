import { beforeEach, expect, test } from "vitest";
import { db, schema } from "@/server/db";
import { AdminAccessError, AdminError, type AdminContext } from "@/server/services/admin/context";
import {
  deviceLabel,
  listSubscriptions,
  removeSubscription,
  saveSubscription,
  sendTestNotification,
} from "@/server/services/admin/notifications";
import { makeUser, resetDb } from "../helpers/db";

beforeEach(resetDb);

const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const apple = "https://web.push.apple.com/QGuQyavXutnMcs";
const fcm = "https://fcm.googleapis.com/fcm/send/abc:def";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

async function admin(): Promise<AdminContext> {
  const u = await makeUser({ role: "admin" });
  return { actorId: u.id, ip: "10.0.0.1" };
}

test("http ya da izinli olmayan alan adı reddedilir", async () => {
  const ctx = await admin();
  for (const endpoint of ["http://fcm.googleapis.com/fcm/send/x", "https://169.254.169.254/latest", "https://example.com/push", "https://fcm.googleapis.com.kotu.example/x", "javascript:alert(1)"]) {
    await expect(saveSubscription(ctx, { endpoint, keys }, ANDROID)).rejects.toBeInstanceOf(AdminError);
  }
  expect(await db.select().from(schema.pushSubscriptions)).toHaveLength(0);
});

test("Apple ve FCM kabul edilir; cihaz adı tarayıcıdan", async () => {
  const ctx = await admin();
  await saveSubscription(ctx, { endpoint: apple, keys }, IPHONE);
  await saveSubscription(ctx, { endpoint: fcm, keys }, ANDROID);
  const list = await listSubscriptions(ctx);
  expect(list.map((s) => s.label).sort()).toEqual(["Android · Chrome", "iPhone · Safari"]);
  // aynı uç nokta ikinci kez eklenmez
  await saveSubscription(ctx, { endpoint: apple, keys }, IPHONE);
  expect(await listSubscriptions(ctx)).toHaveLength(2);
});

test("cihaz adı bilinmeyen tarayıcıda Tarayıcı", () => {
  expect(deviceLabel(null)).toBe("Tarayıcı");
  expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe(
    "Windows · Edge",
  );
});

test("yönetici olmayan abonelik ekleyemez", async () => {
  const u = await makeUser();
  await expect(saveSubscription({ actorId: u.id }, { endpoint: fcm, keys }, ANDROID)).rejects.toBeInstanceOf(AdminAccessError);
});

test("başkasının aboneliği silinemez; kendi aboneliği uç noktayla ya da kimlikle silinir", async () => {
  const a = await admin();
  const b = await admin();
  await saveSubscription(a, { endpoint: fcm, keys }, ANDROID);
  await saveSubscription(a, { endpoint: apple, keys }, IPHONE);
  const [first] = await listSubscriptions(a);
  expect(await removeSubscription(b, { id: first!.id })).toBe(false);
  expect(await removeSubscription(b, { endpoint: fcm })).toBe(false);
  expect(await listSubscriptions(a)).toHaveLength(2);
  expect(await removeSubscription(a, { endpoint: fcm })).toBe(true);
  expect(await removeSubscription(a, { id: (await listSubscriptions(a))[0]!.id })).toBe(true);
  expect(await listSubscriptions(a)).toHaveLength(0);
});

test("başka yöneticinin uç noktasıyla kaydolunca abonelik yeni kullanıcıya geçer", async () => {
  const a = await admin();
  const b = await admin();
  await saveSubscription(a, { endpoint: fcm, keys }, ANDROID);
  await saveSubscription(b, { endpoint: fcm, keys }, ANDROID);
  expect(await listSubscriptions(a)).toHaveLength(0);
  expect(await listSubscriptions(b)).toHaveLength(1);
});

test("deneme bildirimi kutuya kullanıcıya özel yazılır", async () => {
  const a = await admin();
  await sendTestNotification(a, new Date("2026-11-07T12:34:56Z"));
  const [n] = await db.select().from(schema.notifications);
  expect(n).toMatchObject({ kind: "test", title: "Deneme bildirimi", url: "/yonetim/ayarlar/bildirimler", data: { userId: a.actorId } });
  expect(n!.dedupeKey).toBe(`test:${a.actorId}:202611071234`);
});
