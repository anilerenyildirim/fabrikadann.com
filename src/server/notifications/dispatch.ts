import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { webPushSender, type PushResult, type PushSender } from "./push";

const { notifications, pushSubscriptions, users } = schema;

const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
// Bir alımda en fazla bu kadar kayıt; her gönderim en fazla 10 sn sürdüğünden alım süresi (LEASE) içinde biter
const BATCH = 10;
const LEASE_MS = 5 * 60 * 1000;

/**
 * Kutudaki gönderilmemiş bildirimleri yöneticilerin cihazlarına gönderir.
 * Kayıtlar kısa bir işlemle alınır (claimed_at, deneme sayısı +1); gönderim işlem dışında yapılır, böylece
 * ağ beklerken satır ya da bağlantı kilitli kalmaz. Aynı anda iki çağrı aynı kaydı almaz.
 * Alıcılar her seferinde yeniden seçilir: yalnızca rolü admin olanlar.
 */
export async function dispatchPending(opts: { sender?: PushSender | null; now?: Date } = {}) {
  const summary = { sent: 0, failed: 0, expired: 0 };
  const sender = opts.sender === undefined ? webPushSender() : opts.sender;
  if (!sender) return summary;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - MAX_AGE_MS);

  // Eski uyarı ertesi gün gelmesin
  const expired = await db
    .update(notifications)
    .set({ attempts: MAX_ATTEMPTS, claimedAt: null, lastError: "süresi doldu" })
    .where(and(isNull(notifications.sentAt), lt(notifications.attempts, MAX_ATTEMPTS), lt(notifications.createdAt, cutoff)))
    .returning({ id: notifications.id });
  summary.expired = expired.length;

  const rows = await db.transaction(async (tx) => {
    const picked = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          isNull(notifications.sentAt),
          lt(notifications.attempts, MAX_ATTEMPTS),
          gte(notifications.createdAt, cutoff),
          or(isNull(notifications.claimedAt), lt(notifications.claimedAt, new Date(now.getTime() - LEASE_MS))),
        ),
      )
      .orderBy(asc(notifications.createdAt))
      .limit(BATCH)
      .for("update", { skipLocked: true });
    if (picked.length === 0) return [];
    return tx
      .update(notifications)
      .set({ claimedAt: now, attempts: sql`${notifications.attempts} + 1` })
      .where(inArray(notifications.id, picked.map((p) => p.id)))
      .returning();
  });
  if (rows.length === 0) return summary;
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Yetkisi kalkmış kullanıcıların cihazları
  await db
    .delete(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, db.select({ id: users.id }).from(users).where(ne(users.role, "admin"))));
  const subs = await db
    .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
    .where(eq(users.role, "admin"));
  const gone = new Set<string>();

  for (const row of rows) {
    const forUser = row.kind === "test" ? (row.data as { userId?: string } | null)?.userId : undefined;
    const targets = subs.filter((s) => !gone.has(s.id) && (row.kind !== "test" || s.userId === forUser));
    const payload = { title: row.title, body: row.body, url: row.url, tag: row.dedupeKey };
    const results = await Promise.all(
      targets.map(async (s): Promise<[string, PushResult]> => [s.id, await sender.send(s, payload).catch((): PushResult => "error")]),
    );
    const ok = results.filter(([, r]) => r === "ok").map(([id]) => id);
    for (const [id, r] of results) if (r === "gone") gone.add(id);
    if (ok.length) await db.update(pushSubscriptions).set({ lastSuccessAt: now }).where(inArray(pushSubscriptions.id, ok));

    if (ok.length > 0) {
      await db.update(notifications).set({ sentAt: now, claimedAt: null, lastError: null }).where(eq(notifications.id, row.id));
      summary.sent++;
    } else if (results.every(([, r]) => r === "gone")) {
      // Gönderilecek cihaz yok: beklemenin anlamı yok
      await db.update(notifications).set({ sentAt: now, claimedAt: null, lastError: "abone yok" }).where(eq(notifications.id, row.id));
    } else {
      // Deneme sayısı alımda artırıldı; alım bırakılır, sonraki çağrı yeniden dener
      await db.update(notifications).set({ claimedAt: null, lastError: "gönderilemedi" }).where(eq(notifications.id, row.id));
      summary.failed++;
    }
  }
  if (gone.size) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, [...gone]));
  return summary;
}

export async function pruneNotifications(now: Date = new Date()): Promise<number> {
  const rows = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, new Date(now.getTime() - KEEP_MS)))
    .returning({ id: notifications.id });
  return rows.length;
}
