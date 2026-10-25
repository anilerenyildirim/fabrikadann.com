import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";

export const settingsSchema = z.object({
  shippingFee: z.number().int().min(0),
  freeShippingThreshold: z.number().int().min(0),
  companyName: z.string().max(200),
  companyAddress: z.string().max(500),
  taxOffice: z.string().max(100),
  taxNumber: z.string().max(20),
  mersisNumber: z.string().max(30),
  email: z.string().max(200),
  phone: z.string().max(30),
  kepAddress: z.string().max(200),
  // Alt bilgide bağlantı olarak basılır: yalnızca https (javascript: vb. engellenir) ya da boş
  instagramUrl: z.union([z.literal(""), z.string().max(300).url().startsWith("https://")]),
  trendyolUrl: z.union([z.literal(""), z.string().max(300).url().startsWith("https://")]),
  announcement: z.string().max(200),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  shippingFee: 9990,
  freeShippingThreshold: 150000,
  companyName: "",
  companyAddress: "",
  taxOffice: "",
  taxNumber: "",
  mersisNumber: "",
  email: "destek@fabrikadann.com",
  phone: "",
  kepAddress: "",
  instagramUrl: "https://instagram.com/fabrikadann",
  trendyolUrl: "",
  announcement: "",
};

const KEY = "store";

export async function getSettings(): Promise<Settings> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, KEY) });
  const parsed = settingsSchema.partial().safeParse(row?.value ?? {});
  return { ...defaultSettings, ...(parsed.success ? parsed.data : {}) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...patch });
  await db
    .insert(schema.settings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: next } });
  return next;
}
