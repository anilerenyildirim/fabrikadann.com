import { desc, eq, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

const { auditLog, users } = schema;

export const AUDIT_PAGE_SIZE = 100;

/** İşlem günlüğündeki eylem kodlarının Türkçe karşılıkları (bilinmeyenler kod olarak görünür). */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "admin.login.password": "Yönetim girişi: parola doğru",
  "admin.login.failed": "Yönetim girişi: başarısız",
  "admin.login.no_totp": "Yönetim girişi: iki adımlı doğrulama kurulmamış",
  "admin.login.totp": "Yönetim girişi: iki adımlı doğrulama geçti",
  "admin.login.totp_failed": "Yönetim girişi: hatalı doğrulama kodu",
  "admin.login.store_rejected": "Yönetici hesabıyla mağaza girişi denendi (reddedildi)",
  "admin.logout": "Yönetimden çıkış",
  "admin.cli.create": "Yönetici oluşturuldu (betik)",
  "admin.cli.promote": "Kullanıcı yönetici yapıldı (betik)",
  "admin.cli.totp_reset": "İki adımlı doğrulama sıfırlandı (betik)",
  "admin.cli.unlock": "Giriş deneme sınırları sıfırlandı (betik)",
  "product.create": "Ürün oluşturuldu",
  "product.update": "Ürün güncellendi",
  "product.status": "Ürün durumu değişti",
  "color.create": "Renk eklendi",
  "color.rename": "Renk adı değişti",
  "color.delete": "Renk silindi",
  "color.move": "Renk sırası değişti",
  "image.create": "Görsel yüklendi",
  "image.alt": "Görsel alt metni değişti",
  "image.delete": "Görsel silindi",
  "image.move": "Görsel sırası değişti",
  "variant.create": "Numara eklendi",
  "variant.update": "SKU / barkod değişti",
  "variant.delete": "Numara silindi",
  "stock.adjust": "Stok düzeltildi",
  "category.create": "Kategori eklendi",
  "category.update": "Kategori güncellendi",
  "category.delete": "Kategori silindi",
  "category.move": "Kategori sırası değişti",
  "order.status": "Sipariş durumu değişti",
  "order.ship_mail_failed": "Kargo e-postası gönderilemedi",
  "settings.update": "Ayarlar güncellendi",
  "payment.amount_mismatch": "Ödeme tutarı uyuşmadı",
  "payment.needs_refund": "İade gereken ödeme",
  "payment.refund_resolved": "İade yapıldı olarak işaretlendi",
};

export function auditLabel(action: string): string {
  return Object.hasOwn(AUDIT_ACTION_LABELS, action) ? AUDIT_ACTION_LABELS[action]! : action;
}

/** Günlük süzgeci: grup → eylem kodu önekleri. */
export const AUDIT_GROUPS: Record<string, string[]> = {
  order: ["order"],
  payment: ["payment"],
  product: ["product", "color", "image", "variant"],
  stock: ["stock"],
  category: ["category"],
  settings: ["settings"],
  admin: ["admin"],
};

export async function listAuditEntries(input: { page?: number; group?: string } = {}) {
  const page = Math.max(1, Math.min(Math.trunc(input.page ?? 1) || 1, 10_000));
  // Yalnızca tanımlı gruplar ("constructor" gibi nesne özellikleri süzgeç sayılmaz)
  const prefixes = input.group && Object.hasOwn(AUDIT_GROUPS, input.group) ? AUDIT_GROUPS[input.group] : undefined;
  const filter = prefixes ? or(...prefixes.map((p) => like(auditLog.action, `${p}.%`))) : undefined;
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        target: auditLog.target,
        data: auditLog.data,
        ip: auditLog.ip,
        createdAt: auditLog.createdAt,
        actorEmail: users.email,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(filter)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(filter),
  ]);
  const total = count?.n ?? 0;
  return { items: rows, total, page, pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
}
