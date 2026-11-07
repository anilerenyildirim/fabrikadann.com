import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { enqueueNotification } from "@/server/notifications/outbox";
import { dispatchPending, pruneNotifications } from "@/server/notifications/dispatch";
import type { PushPayload, PushResult, PushSender } from "@/server/notifications/push";
import { makeUser, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

class FakeSender implements PushSender {
  calls: { endpoint: string; payload: PushPayload }[] = [];
  results = new Map<string, PushResult>();
  async send(sub: { endpoint: string }, payload: PushPayload): Promise<PushResult> {
    this.calls.push({ endpoint: sub.endpoint, payload });
    return this.results.get(sub.endpoint) ?? "ok";
  }
}

let n = 0;
async function subscribe(userId: string) {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${++n}`;
  await db.insert(schema.pushSubscriptions).values({ userId, endpoint, p256dh: "p", auth: "a", label: "Android · Chrome" });
  return endpoint;
}

const note = (dedupeKey = "site:order:FD-1", extra: Partial<Parameters<typeof enqueueNotification>[1]> = {}) =>
  enqueueNotification(db, { kind: "order_new", source: "site", title: "Yeni sipariş FD-1", body: "1 ürün", url: "/yonetim/siparisler/x", dedupeKey, ...extra });

const one = async () => (await db.select().from(schema.notifications))[0]!;
const subs = () => db.select().from(schema.pushSubscriptions);

test("yalnızca yönetici abonelerine gider; gönderilince sentAt yazılır", async () => {
  const admin = await makeUser({ role: "admin" });
  const customer = await makeUser();
  const a = await subscribe(admin.id);
  await subscribe(customer.id);
  await note();
  const sender = new FakeSender();
  expect(await dispatchPending({ sender })).toMatchObject({ sent: 1 });
  expect(sender.calls.map((c) => c.endpoint)).toEqual([a]);
  expect(sender.calls[0]!.payload).toEqual({ title: "Yeni sipariş FD-1", body: "1 ürün", url: "/yonetim/siparisler/x", tag: "site:order:FD-1" });
  expect((await one()).sentAt).not.toBeNull();
  // ikinci çağrı yeniden göndermez
  await dispatchPending({ sender });
  expect(sender.calls).toHaveLength(1);
});

test("rolü kaldırılan kullanıcının aboneliği silinir ve ona gönderilmez", async () => {
  const user = await makeUser({ role: "admin" });
  await subscribe(user.id);
  await db.update(schema.users).set({ role: "customer" }).where(eq(schema.users.id, user.id));
  await note();
  const sender = new FakeSender();
  await dispatchPending({ sender });
  expect(sender.calls).toHaveLength(0);
  expect(await subs()).toHaveLength(0);
});

test("gone dönen abonelik silinir", async () => {
  const admin = await makeUser({ role: "admin" });
  const a = await subscribe(admin.id);
  const b = await subscribe(admin.id);
  const sender = new FakeSender();
  sender.results.set(a, "gone");
  await note();
  await dispatchPending({ sender });
  expect((await subs()).map((s) => s.endpoint)).toEqual([b]);
  expect((await one()).sentAt).not.toBeNull();
});

test("hata deneme sayısını artırır; 5 denemeden sonra gönderilmez", async () => {
  const admin = await makeUser({ role: "admin" });
  const a = await subscribe(admin.id);
  const sender = new FakeSender();
  sender.results.set(a, "error");
  await note();
  for (let i = 0; i < 6; i++) await dispatchPending({ sender });
  expect(sender.calls).toHaveLength(5);
  const row = await one();
  expect(row.attempts).toBe(5);
  expect(row.sentAt).toBeNull();
});

test("24 saatten eski bildirim gönderilmez, süresi doldu yazılır", async () => {
  const admin = await makeUser({ role: "admin" });
  await subscribe(admin.id);
  await note();
  const sender = new FakeSender();
  const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
  expect(await dispatchPending({ sender, now: later })).toMatchObject({ expired: 1 });
  expect(sender.calls).toHaveLength(0);
  expect((await one()).lastError).toBe("süresi doldu");
});

test("eşzamanlı iki gönderim aynı bildirimi bir kez gönderir", async () => {
  const admin = await makeUser({ role: "admin" });
  await subscribe(admin.id);
  await note();
  const sender = new FakeSender();
  const slow: PushSender = { send: async (s, p) => (await new Promise((r) => setTimeout(r, 50)), sender.send(s, p)) };
  await Promise.all([dispatchPending({ sender: slow }), dispatchPending({ sender: slow })]);
  expect(sender.calls).toHaveLength(1);
});

test("gönderici yoksa (anahtar tanımsız) bildirim beklemede kalır", async () => {
  const admin = await makeUser({ role: "admin" });
  await subscribe(admin.id);
  await note();
  expect(await dispatchPending({ sender: null })).toEqual({ sent: 0, failed: 0, expired: 0 });
  expect((await one()).sentAt).toBeNull();
});

test("deneme bildirimi yalnızca data.userId kullanıcısının cihazına gider", async () => {
  const a = await makeUser({ role: "admin" });
  const b = await makeUser({ role: "admin" });
  const ea = await subscribe(a.id);
  await subscribe(b.id);
  await note("test:x", { kind: "test", url: "/yonetim/ayarlar/bildirimler", data: { userId: a.id } });
  const sender = new FakeSender();
  await dispatchPending({ sender });
  expect(sender.calls.map((c) => c.endpoint)).toEqual([ea]);
});

test("30 günden eski kayıtlar silinir", async () => {
  await note();
  expect(await pruneNotifications(new Date(Date.now() + 31 * 24 * 60 * 60 * 1000))).toBe(1);
  expect(await db.select().from(schema.notifications)).toHaveLength(0);
});
