import { desc } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@/server/db";

export type AuditEntry = {
  action: string;
  actorId?: string | null;
  target?: string | null;
  data?: Record<string, unknown> | null;
  ip?: string | null;
};

export async function audit(entry: AuditEntry, tx: DbOrTx = db): Promise<void> {
  await tx.insert(schema.auditLog).values({
    action: entry.action,
    actorId: entry.actorId ?? null,
    target: entry.target ?? null,
    data: entry.data ?? null,
    ip: entry.ip ?? null,
  });
}

export async function listAudit(limit = 200) {
  return db.query.auditLog.findMany({
    orderBy: [desc(schema.auditLog.createdAt)],
    limit,
  });
}
