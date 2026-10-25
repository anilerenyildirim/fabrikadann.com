import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";

/** Yönetim servislerini çağıran: oturumdan gelen kullanıcı kimliği ve istek IP'si. */
export type AdminContext = { actorId: string; ip?: string | null };

/** Kullanıcıya gösterilebilecek, düzeltilebilir hata (ör. "Bu SKU kullanılıyor"). */
export class AdminError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

/** Çağıranın yönetici olmadığı durum. Sayfa katmanı yalnızca genel bir mesaj gösterir. */
export class AdminAccessError extends Error {
  constructor() {
    super("Bu işlem için yönetici yetkisi gerekli.");
  }
}

/**
 * Sayfa katmanındaki requireAdmin()'e ek savunma: servis, çağıranın veritabanında hâlâ yönetici
 * olduğunu kendisi doğrular (ileride API'den çağrıldığında da aynı kural geçerli olsun).
 */
export async function assertAdmin(ctx: AdminContext): Promise<void> {
  if (!ctx?.actorId || !/^[0-9a-f-]{36}$/i.test(ctx.actorId)) throw new AdminAccessError();
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, ctx.actorId),
    columns: { role: true },
  });
  if (!user || user.role !== "admin") throw new AdminAccessError();
}

/** Postgres benzersizlik ihlali (23505) mi? Drizzle hatayı sarmalayabildiği için cause'a da bakılır. */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    if (typeof cur === "object" && cur !== null && "code" in cur && (cur as { code?: unknown }).code === "23505") {
      return true;
    }
    cur = typeof cur === "object" && cur !== null && "cause" in cur ? (cur as { cause?: unknown }).cause : undefined;
  }
  return false;
}

/** Sıralı kardeşler içinde bir öğeyi yukarı/aşağı taşır; konumları 0..n-1 olarak yeniden yazar. */
export function reorder<T extends { id: string }>(items: T[], id: string, direction: "up" | "down"): T[] | null {
  const index = items.findIndex((i) => i.id === id);
  if (index === -1) return null;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
