import { and, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { randomToken, sha256 } from "./crypto";

const DAY = 24 * 60 * 60 * 1000;
export const CUSTOMER_SESSION_MS = 30 * DAY;
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;

export type SessionUser = Pick<
  typeof schema.users.$inferSelect,
  "id" | "email" | "firstName" | "lastName" | "phone" | "role"
>;

export type ValidSession = {
  user: SessionUser;
  secondFactor: boolean;
  expiresAt: Date;
};

export async function createSession(userId: string, role: "customer" | "admin") {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + (role === "admin" ? ADMIN_SESSION_MS : CUSTOMER_SESSION_MS));
  await db.insert(schema.sessions).values({ idHash: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string): Promise<ValidSession | null> {
  if (!token || token.length > 100) return null;
  const rows = await db
    .select({
      expiresAt: schema.sessions.expiresAt,
      secondFactorAt: schema.sessions.secondFactorAt,
      user: {
        id: schema.users.id,
        email: schema.users.email,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        phone: schema.users.phone,
        role: schema.users.role,
      },
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.idHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { user: row.user, secondFactor: row.secondFactorAt !== null, expiresAt: row.expiresAt };
}

export async function markSecondFactor(token: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ secondFactorAt: new Date() })
    .where(eq(schema.sessions.idHash, sha256(token)));
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.idHash, sha256(token)));
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export async function pruneSessions(): Promise<void> {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}
