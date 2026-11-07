import { getSecret } from "@/server/secrets";
import { N11Client, N11Error, n11Config, type N11Config } from "./client";

export const N11_NOT_CONFIGURED = "N11 bağlantısı tanımlı değil. Ayarlar > API anahtarları'ndan N11 anahtar ve şifresini girin.";

/** Panel kaydı (yoksa ortam) ile N11 ayarı; tanımlı değilse null, yarımsa hata. */
export async function n11ConfigAsync(): Promise<N11Config | null> {
  return n11Config({ N11_API_KEY: (await getSecret("N11_API_KEY")) ?? undefined, N11_API_SECRET: (await getSecret("N11_API_SECRET")) ?? undefined });
}

/** N11 istemcisi; tanımlı değilse hata mesajı. */
export async function n11ClientOrError(): Promise<{ client: N11Client } | { error: string }> {
  try {
    const cfg = await n11ConfigAsync();
    return cfg ? { client: new N11Client(cfg) } : { error: N11_NOT_CONFIGURED };
  } catch (e) {
    return { error: e instanceof N11Error ? e.message : "N11 ayarları hatalı." };
  }
}
