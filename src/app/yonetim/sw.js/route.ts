// Yönetim uygulamasının service worker'ı: yalnızca bildirimi gösterir ve dokununca panel sayfasını açar.
// Sayfa önbelleği yok (panel her zaman güncel veriyle açılır).
export const dynamic = "force-static";

const source = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  const url = typeof d.url === "string" && (d.url === "/yonetim" || d.url.startsWith("/yonetim/")) ? d.url : "/yonetim";
  e.waitUntil(self.registration.showNotification(d.title || "Fabrikadann", {
    body: d.body || "",
    tag: d.tag,
    data: { url },
    icon: "/yonetim/icon-192.png",
    badge: "/yonetim/badge-96.png",
    lang: "tr",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/yonetim", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname.startsWith("/yonetim"));
    // navigate() bu worker'ın denetlemediği pencerede reddedilir: o zaman yeni pencere
    if (open) return open.focus().then((c) => (c || open).navigate(url)).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
`;

export function GET() {
  return new Response(source, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
