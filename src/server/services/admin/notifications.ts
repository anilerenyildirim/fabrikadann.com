import { and, asc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { enqueueNotification } from "@/server/notifications/outbox";
import { isAllowedPushEndpoint } from "@/server/notifications/push";
import { AdminError, assertAdmin, type AdminContext } from "./context";

const { pushSubscriptions } = schema;

const base64url = (max: number) => z.string().min(8).max(max).regex(/^[A-Za-z0-9_-]+=*$/);

export const subscriptionInput = z.object({
  endpoint: z.string().max(1000),
  keys: z.object({ p256dh: base64url(200), auth: base64url(100) }),
});
export type SubscriptionInput = z.infer<typeof subscriptionInput>;

/** Cihaz listesinde gösterilen ad: "iPhone · Safari" gibi (tarayıcının kendi bildirdiği bilgiden). */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Tarayıcı";
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\/|FxiOS/.test(ua)
      ? "Firefox"
      : /Chrome\/|CriOS/.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  if (!device && !browser) return "Tarayıcı";
  return [device, browser].filter(Boolean).join(" · ");
}

export async function saveSubscription(ctx: AdminContext, raw: unknown, userAgent: string | null): Promise<void> {
  await assertAdmin(ctx);
  const parsed = subscriptionInput.safeParse(raw);
  if (!parsed.success || !isAllowedPushEndpoint(parsed.data.endpoint)) {
    throw new AdminError("Bu tarayıcının bildirim adresi kabul edilmedi. Safari, Chrome, Firefox ya da Edge ile yeniden deneyin.");
  }
  const { endpoint, keys } = parsed.data;
  const values = { userId: ctx.actorId, endpoint, p256dh: keys.p256dh, auth: keys.auth, label: deviceLabel(userAgent).slice(0, 60) };
  // Aynı tarayıcı başka hesapla kaydolduysa abonelik son giriş yapan yöneticiye geçer
  await db
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: values.userId, p256dh: values.p256dh, auth: values.auth, label: values.label } });
}

export async function removeSubscription(ctx: AdminContext, by: { id?: string; endpoint?: string }): Promise<boolean> {
  await assertAdmin(ctx);
  const conds = [];
  if (by.id && /^[0-9a-f-]{36}$/i.test(by.id)) conds.push(eq(pushSubscriptions.id, by.id));
  if (by.endpoint) conds.push(eq(pushSubscriptions.endpoint, by.endpoint.slice(0, 1000)));
  if (conds.length === 0) return false;
  const rows = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, ctx.actorId), or(...conds)))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

export async function listSubscriptions(ctx: AdminContext) {
  await assertAdmin(ctx);
  return db
    .select({ id: pushSubscriptions.id, label: pushSubscriptions.label, createdAt: pushSubscriptions.createdAt, lastSuccessAt: pushSubscriptions.lastSuccessAt })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, ctx.actorId))
    .orderBy(asc(pushSubscriptions.createdAt));
}

/** Yalnızca çağıranın cihazlarına giden deneme bildirimi (dakikada en fazla bir). */
export async function sendTestNotification(ctx: AdminContext, now: Date = new Date()): Promise<boolean> {
  await assertAdmin(ctx);
  const minute = now.toISOString().slice(0, 16).replace(/[-T:]/g, "");
  return enqueueNotification(db, {
    kind: "test",
    source: "site",
    title: "Deneme bildirimi",
    body: "Bildirimler bu cihazda çalışıyor.",
    url: "/yonetim/ayarlar/bildirimler",
    dedupeKey: `test:${ctx.actorId}:${minute}`,
    data: { userId: ctx.actorId },
  });
}
