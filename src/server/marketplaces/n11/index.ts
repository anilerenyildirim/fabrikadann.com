import { N11Client, N11Error, n11Config } from "./client";

export const N11_NOT_CONFIGURED = "N11 bağlantısı tanımlı değil. Sunucuda N11_API_KEY ve N11_API_SECRET tanımlayın.";

/** Ortamdan N11 istemcisi; tanımlı değilse hata mesajı. */
export function n11ClientOrError(): { client: N11Client } | { error: string } {
  try {
    const cfg = n11Config();
    return cfg ? { client: new N11Client(cfg) } : { error: N11_NOT_CONFIGURED };
  } catch (e) {
    return { error: e instanceof N11Error ? e.message : "N11 ayarları hatalı." };
  }
}
