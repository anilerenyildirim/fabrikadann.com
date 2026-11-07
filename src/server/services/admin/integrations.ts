import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { deleteSecret, secretSource, storeSecret, type SecretName } from "@/server/secrets";
import { audit } from "../audit";
import { AdminError, assertAdmin, type AdminContext } from "./context";

export type IntegrationId = "claude" | "n11" | "trendyol" | "iyzico" | "smtp" | "webpush";

type Definition = {
  id: IntegrationId;
  name: string;
  purpose: string;
  /** Panelden girilebilen anahtarlar (şifreli saklanır) */
  secrets?: SecretName[];
  /** Yalnızca sunucu dosyasında duran değişkenler */
  env?: string[];
};

export const INTEGRATIONS: Definition[] = [
  { id: "claude", name: "Claude (AI Asistan)", purpose: "Fotoğraftan ürün bilgisi önerisi", secrets: ["ANTHROPIC_API_KEY"] },
  { id: "n11", name: "N11", purpose: "Ürün yükleme, ortak stok, sipariş", secrets: ["N11_API_KEY", "N11_API_SECRET"] },
  { id: "trendyol", name: "Trendyol", purpose: "Ortak stok, sipariş, ürün aktarma", env: ["TRENDYOL_SELLER_ID", "TRENDYOL_API_KEY", "TRENDYOL_API_SECRET"] },
  { id: "iyzico", name: "iyzico", purpose: "Kartla ödeme", env: ["IYZICO_API_KEY", "IYZICO_SECRET_KEY"] },
  { id: "smtp", name: "E-posta (SMTP)", purpose: "Sipariş, üyelik ve mağaza e-postaları", env: ["SMTP_URL"] },
  { id: "webpush", name: "Telefon bildirimleri", purpose: "Yönetici uygulamasına anlık bildirim", env: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] },
];

export type TestResult = { ok: boolean; message: string };
/** Anahtarı ücretsiz bir istekle dener (sağlayıcıya göre). */
export type Testers = Partial<Record<IntegrationId, (values: Record<string, string>) => Promise<TestResult>>>;

/** Europe/Istanbul takvim günü (YYYY-MM-DD). */
export function istanbulDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function daysUntil(date: string, now: Date): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${istanbulDate(now)}T00:00:00Z`)) / 86_400_000);
}

export async function listIntegrations(now: Date = new Date()) {
  const rows = await db.select().from(schema.integrations);
  const out = [];
  for (const d of INTEGRATIONS) {
    const row = rows.find((r) => r.id === d.id);
    const secrets = [];
    for (const name of d.secrets ?? []) secrets.push({ name, ...(await secretSource(name)) });
    const envs = (d.env ?? []).map((name) => ({ name, source: process.env[name]?.trim() ? ("env" as const) : null }));
    const configured = d.secrets ? secrets.every((s) => s.source) : envs.every((e) => e.source);
    out.push({
      id: d.id,
      name: d.name,
      purpose: d.purpose,
      editable: !!d.secrets,
      configured,
      secrets,
      env: envs,
      expiresAt: row?.expiresAt ?? null,
      daysLeft: row?.expiresAt ? daysUntil(row.expiresAt, now) : null,
      checkedAt: row?.checkedAt ?? null,
      ok: row?.ok ?? null,
      message: row?.message ?? null,
    });
  }
  return out;
}

export type IntegrationRow = Awaited<ReturnType<typeof listIntegrations>>[number];

export async function recordCheck(id: IntegrationId, result: TestResult | null, now: Date) {
  const values = { checkedAt: now, ok: result?.ok ?? null, message: result?.message.slice(0, 300) ?? null };
  await db.insert(schema.integrations).values({ id, ...values }).onConflictDoUpdate({ target: schema.integrations.id, set: values });
}

const secretValue = z
  .string()
  .trim()
  .min(4, "Anahtar çok kısa. Panelden kopyalarken eksik kalmış olabilir.")
  .max(500, "Anahtar en fazla 500 karakter olabilir.")
  .regex(/^\S+$/, "Anahtarda boşluk olamaz. Kopyalarken araya boşluk girmiş olabilir.");

/** Anahtarları dener; çalışıyorsa şifreleyip kaydeder. Değer günlüğe yazılmaz. */
export async function saveIntegrationKeys(ctx: AdminContext, id: IntegrationId, raw: Record<string, unknown>, testers: Testers): Promise<void> {
  await assertAdmin(ctx);
  const def = INTEGRATIONS.find((d) => d.id === id);
  if (!def?.secrets) throw new AdminError("Bu bağlantının anahtarı panelden değiştirilemez; sunucu dosyasından değiştirilir.");
  const values: Record<string, string> = {};
  for (const name of def.secrets) {
    const v = secretValue.safeParse(raw[name] ?? "");
    if (!v.success) throw new AdminError(`${name}: ${v.error.issues[0]?.message ?? "geçersiz"}`, name);
    values[name] = v.data;
  }
  const tester = testers[id];
  if (tester) {
    const result = await tester(values);
    if (!result.ok) throw new AdminError(`Anahtar denendi, çalışmadı: ${result.message} Kaydedilmedi.`);
    await recordCheck(id, result, new Date());
  }
  for (const [name, value] of Object.entries(values)) await storeSecret(name as SecretName, value, ctx.actorId);
  await audit({ action: "integration.secret_set", actorId: ctx.actorId, ip: ctx.ip ?? null, target: id, data: { names: Object.keys(values) } });
}

export async function clearIntegrationKeys(ctx: AdminContext, id: IntegrationId): Promise<void> {
  await assertAdmin(ctx);
  const def = INTEGRATIONS.find((d) => d.id === id);
  if (!def?.secrets) throw new AdminError("Bu bağlantının panelde kayıtlı anahtarı yok.");
  for (const name of def.secrets) await deleteSecret(name);
  await db.update(schema.integrations).set({ ok: null, message: null, checkedAt: null }).where(eq(schema.integrations.id, id));
  await audit({ action: "integration.secret_cleared", actorId: ctx.actorId, ip: ctx.ip ?? null, target: id });
}

export async function setIntegrationExpiry(ctx: AdminContext, id: IntegrationId, date: string | null, now: Date = new Date()): Promise<void> {
  await assertAdmin(ctx);
  if (!INTEGRATIONS.some((d) => d.id === id)) throw new AdminError("Bağlantı bulunamadı.");
  if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) {
    throw new AdminError("Tarihi takvimden seçin.", "expiresAt");
  }
  if (date !== null && daysUntil(date, now) < -365) throw new AdminError("Tarih bir yıldan eski olamaz.", "expiresAt");
  await db
    .insert(schema.integrations)
    .values({ id, expiresAt: date })
    .onConflictDoUpdate({ target: schema.integrations.id, set: { expiresAt: date } });
  await audit({ action: "integration.expiry_set", actorId: ctx.actorId, ip: ctx.ip ?? null, target: id, data: { expiresAt: date } });
}
