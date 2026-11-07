import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().transform((u) => u.replace(/\/$/, "")),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET en az 32 karakter olmalı"),
  PAYMENT_PROVIDER: z.enum(["mock", "iyzico"]).default("mock"),
  UPLOAD_DIR: z.string().default("./uploads"),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("fabrikadann <info@fabrikadann.com>"),
  ORDER_NOTIFY_EMAIL: z.string().optional(),
  // Web Push (yönetici bildirimleri): üçü birlikte tanımlanır ya da hiçbiri
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  // N11 (ikisi birlikte ya da hiçbiri)
  N11_API_KEY: z.string().optional(),
  N11_API_SECRET: z.string().optional(),
  // AI Asistan (Claude API); boşsa asistan kapalı
  ANTHROPIC_API_KEY: z.string().optional(),
}).superRefine((e, ctx) => {
  if (!!e.N11_API_KEY?.trim() !== !!e.N11_API_SECRET?.trim()) {
    ctx.addIssue({ code: "custom", path: ["N11_API_KEY"], message: "N11_API_KEY ve N11_API_SECRET birlikte tanımlanmalı" });
  }
  const set = [e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY, e.VAPID_SUBJECT].filter((v) => v?.trim()).length;
  if (set !== 0 && set !== 3) {
    ctx.addIssue({ code: "custom", path: ["VAPID_PUBLIC_KEY"], message: "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY ve VAPID_SUBJECT birlikte tanımlanmalı" });
  }
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Ortam değişkenleri eksik ya da hatalı:\n${fields}`);
  }
  return parsed.data;
}

export const env = load();
export const isProd = env.NODE_ENV === "production";
