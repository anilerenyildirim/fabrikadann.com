import webpush from "web-push";
import { logError } from "@/server/log";

export type PushPayload = { title: string; body: string; url: string; tag: string };
export type PushResult = "ok" | "gone" | "error";
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export interface PushSender {
  send(sub: PushTarget, payload: PushPayload): Promise<PushResult>;
}

// Tarayıcıların push servisleri; sunucu başka adrese istek atmaz
const ALLOWED_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export function isAllowedPushEndpoint(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  return ALLOWED_HOSTS.some((re) => re.test(u.hostname));
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

/** VAPID anahtarları tanımlı değilse null: bildirimler kutuda bekler, gönderilmez. */
export function webPushSender(): PushSender | null {
  const publicKey = vapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return {
    async send(sub, payload) {
      if (!isAllowedPushEndpoint(sub.endpoint)) return "gone";
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
          vapidDetails: { subject, publicKey, privateKey },
          TTL: 86400,
          urgency: "high",
          timeout: 10000,
        });
        return "ok";
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return "gone";
        logError("Bildirim gönderilemedi", e);
        return "error";
      }
    },
  };
}
