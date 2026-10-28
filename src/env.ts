import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().transform((u) => u.replace(/\/$/, "")),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET en az 32 karakter olmalı"),
  PAYMENT_PROVIDER: z.enum(["mock", "iyzico"]).default("mock"),
  UPLOAD_DIR: z.string().default("./uploads"),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("fabrikadann <satis@fabrikadann.com>"),
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
