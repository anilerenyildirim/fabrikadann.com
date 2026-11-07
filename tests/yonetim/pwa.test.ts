import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import { GET as manifestGET } from "@/app/yonetim/manifest.webmanifest/route";
import { GET as swGET } from "@/app/yonetim/sw.js/route";

test("manifest: açılış adresi kapsamın içinde, kapsam yalnızca yönetim", async () => {
  const m = await manifestGET().json();
  expect(m.scope).toBe("/yonetim");
  expect(m.start_url.startsWith(m.scope)).toBe(true);
});

test("service worker: açık pencere yönlendirilemezse yeni pencerede açar", async () => {
  const source = await swGET().text();
  const listeners: Record<string, (e: unknown) => void> = {};
  const opened: string[] = [];
  const win = { url: "https://fabrikadann.com/yonetim/stok", focus: async () => win, navigate: async () => Promise.reject(new TypeError("kontrol edilmiyor")) };
  const self = {
    location: { origin: "https://fabrikadann.com" },
    addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] = f),
    clients: { matchAll: async () => [win], openWindow: async (u: string) => opened.push(u), claim: async () => {} },
    registration: {},
    skipWaiting: () => {},
  };
  runInNewContext(source, { self, URL });
  let done: Promise<unknown> = Promise.resolve();
  listeners.notificationclick!({ notification: { close() {}, data: { url: "/yonetim/siparisler/1" } }, waitUntil: (p: Promise<unknown>) => (done = p) });
  await done;
  expect(opened).toEqual(["https://fabrikadann.com/yonetim/siparisler/1"]);
});
