import { schema, type DbOrTx } from "@/server/db";

export type NotificationKind = (typeof schema.notificationKind.enumValues)[number];
export type NotificationSource = "site" | "trendyol" | "n11" | "hepsiburada" | "system";

export type NotificationInput = {
  kind: NotificationKind;
  source: NotificationSource;
  title: string;
  body: string;
  /** Bildirime dokununca açılacak panel adresi; yalnızca /yonetim altı */
  url: string;
  /** Aynı olay iki kez yazılmasın (ör. site:order:FD-1234) */
  dedupeKey: string;
  data?: unknown;
};

export function isPanelUrl(url: string) {
  return url === "/yonetim" || url.startsWith("/yonetim/");
}

/**
 * Bildirimi kutuya yazar; olayın kendi işlemi (tx) içinde çağrılır. Aynı anahtar varsa yazmaz (false).
 * Gönderim ayrı: dispatchPending.
 */
export async function enqueueNotification(conn: DbOrTx, input: NotificationInput): Promise<boolean> {
  if (!isPanelUrl(input.url)) throw new Error("Bildirim adresi /yonetim altında olmalı");
  const rows = await conn
    .insert(schema.notifications)
    .values({
      kind: input.kind,
      source: input.source,
      title: input.title.slice(0, 80),
      body: input.body.slice(0, 200),
      url: input.url,
      dedupeKey: input.dedupeKey,
      data: input.data ?? null,
    })
    .onConflictDoNothing({ target: schema.notifications.dedupeKey })
    .returning({ id: schema.notifications.id });
  return rows.length > 0;
}
