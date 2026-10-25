import { sql } from "drizzle-orm";
import { db } from "@/server/db";

export type RateLimitResult = { ok: boolean; retryAfter: number };

/**
 * Sabit pencereli sayaç. Veritabanında tutulur, birden çok sunucu örneğinde de doğru çalışır;
 * tek atomik ifade olduğu için eşzamanlı isteklerde sayaç atlanmaz.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const result = await db.execute<{ count: number; reset_at: Date }>(sql`
    INSERT INTO rate_limits (key, count, reset_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSec}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= now() THEN excluded.reset_at ELSE rate_limits.reset_at END
    RETURNING count, reset_at
  `);
  const row = result.rows[0]!;
  const retryAfter = Math.max(0, Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000));
  return { ok: row.count <= limit, retryAfter };
}

export async function clearRateLimit(key: string): Promise<void> {
  await db.execute(sql`DELETE FROM rate_limits WHERE key = ${key}`);
}

export async function pruneRateLimits(): Promise<void> {
  await db.execute(sql`DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day'`);
}
