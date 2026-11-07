import { after } from "next/server";
import { logError } from "@/server/log";
import { dispatchPending } from "./dispatch";

/** Bekleyen bildirimleri yanıt gönderildikten sonra yollar (push servisi yavaşsa istek beklemesin). */
export function dispatchAfterResponse(): void {
  const run = () => dispatchPending().then(() => undefined, (e) => logError("Anlık bildirim gönderilemedi", e));
  try {
    after(run);
  } catch {
    // İstek bağlamı yoksa (betik, test) beklemeden başlat
    void run();
  }
}
