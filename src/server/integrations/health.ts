import { sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { enqueueNotification } from "@/server/notifications/outbox";
import { getSecret } from "@/server/secrets";
import { daysUntil, INTEGRATIONS, istanbulDate, recordCheck, type IntegrationId, type Testers } from "@/server/services/admin/integrations";
import { defaultTesters } from "./testers";

const CHECK_EVERY_MS = 60 * 60_000;
const URL = "/yonetim/ayarlar/api-anahtarlari";

function expiryBucket(days: number): { key: string; title: (name: string) => string } | null {
  if (days > 7) return null;
  if (days <= 0) return { key: "0", title: (n) => `${n} anahtarının süresi doldu` };
  if (days <= 1) return { key: "1", title: (n) => `${n} anahtarının süresi yarın doluyor` };
  if (days <= 3) return { key: "3", title: (n) => `${n} anahtarının süresi ${days} gün sonra doluyor` };
  return { key: "7", title: (n) => `${n} anahtarının süresi ${days} gün sonra doluyor` };
}

/**
 * Tüm entegrasyonları kontrol eder: tanımlıysa ücretsiz bir istekle dener, sonucu kaydeder; çalışmıyorsa (günde bir)
 * ve son kullanmaya 7/3/1 gün kala ya da geçince (eşik başına bir kez) yöneticilere bildirim yazar.
 */
export async function checkIntegrations(opts: { now?: Date; testers?: Testers } = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const testers = opts.testers ?? defaultTesters;
  const today = istanbulDate(now);
  const rows = await db.select().from(schema.integrations);
  for (const def of INTEGRATIONS) {
    const values: Record<string, string> = {};
    let configured = true;
    for (const name of def.secrets ?? []) {
      const v = await getSecret(name);
      if (v) values[name] = v;
      else configured = false;
    }
    for (const name of def.env ?? []) if (!process.env[name]?.trim()) configured = false;

    const tester = testers[def.id as IntegrationId];
    const result = configured && tester ? await tester(values) : configured ? null : { ok: false, message: "Tanımlı değil" };
    await recordCheck(def.id, configured ? result : null, now);
    if (configured && result && !result.ok) {
      await enqueueNotification(db, {
        kind: "integration",
        source: "system",
        title: `${def.name} bağlantısı çalışmıyor`,
        body: result.message,
        url: URL,
        dedupeKey: `integration:${def.id}:fail:${today}`,
      });
    }

    const expiresAt = rows.find((r) => r.id === def.id)?.expiresAt;
    if (!expiresAt) continue;
    const days = daysUntil(expiresAt, now);
    const bucket = expiryBucket(days);
    if (!bucket) continue;
    await enqueueNotification(db, {
      kind: "integration",
      source: "system",
      title: bucket.title(def.name),
      body: days <= 0 ? "Yeni anahtarı Ayarlar > API anahtarları'ndan girin; girilene kadar bu bağlantı çalışmaz." : "Yenisini alıp Ayarlar > API anahtarları'ndan girin.",
      url: URL,
      dedupeKey: `integration:${def.id}:expiry:${bucket.key}:${expiresAt}`,
    });
  }
}

/** Bakım betiği her 5 dakikada çağırır; kontrol saatte bir yapılır. Çalıştıysa true. */
export async function checkIntegrationsIfDue(opts: { now?: Date; testers?: Testers } = {}): Promise<boolean> {
  const now = opts.now ?? new Date();
  const [r] = await db.select({ last: sql<Date | null>`max(${schema.integrations.checkedAt})` }).from(schema.integrations);
  const last = r?.last ? new Date(r.last) : null;
  if (last && now.getTime() - last.getTime() < CHECK_EVERY_MS) return false;
  await checkIntegrations({ ...opts, now });
  return true;
}
