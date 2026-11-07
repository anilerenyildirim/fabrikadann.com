"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, FormNotice } from "@/components/ui/form";
import { currentPushSubscription } from "./PushRegistration";

type Status = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

type Actions = {
  subscribe: (json: unknown) => Promise<{ ok: true } | { error: string }>;
  unsubscribe: (endpoint: unknown) => Promise<{ ok: true }>;
};

function keyBytes(base64url: string) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("zaman aşımı")), ms))]);
}

async function detect(): Promise<Status> {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return ios && !standalone ? "ios-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return (await currentPushSubscription()) ? "on" : "off";
}

/** "Bu cihazda bildirimleri aç/kapat". iPhone'da yalnızca ana ekrana eklenen uygulamada çalışır. */
export function PushToggle({ vapidKey, actions }: { vapidKey: string; actions: Actions }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    detect().then(setStatus, () => setStatus("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/yonetim/sw.js", { scope: "/yonetim/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      // Tarayıcının push servisi yanıt vermezse düğme sonsuza dek beklemesin
      const sub = await withTimeout(
        (async () =>
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) })))(),
        20000,
      );
      const res = await actions.subscribe(sub.toJSON());
      if ("error" in res) {
        await sub.unsubscribe().catch(() => false);
        setError(res.error);
        return;
      }
      setStatus("on");
      router.refresh();
    } catch {
      setError("Bildirimler açılamadı: tarayıcı bildirim servisine bağlanamadı. İnternet bağlantınızı kontrol edip sayfayı yenileyin, yeniden deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const sub = await currentPushSubscription();
      if (sub) {
        await actions.unsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
      router.refresh();
    } catch {
      setError("Bildirimler kapatılamadı. Sayfayı yenileyip yeniden deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <FormNotice>{error}</FormNotice>}
      {status === "loading" && <p className="text-[0.8125rem] text-graphite">Bu cihaz denetleniyor…</p>}
      {status === "ios-install" && (
        <FormNotice tone="info">
          iPhone&apos;da bildirim için önce Safari&apos;de Paylaş → Ana Ekrana Ekle&apos;ye dokunun, sonra uygulamayı ana ekrandaki Fabrikadann
          simgesinden açıp bu sayfaya gelin.
        </FormNotice>
      )}
      {status === "unsupported" && (
        <FormNotice tone="info">Bu tarayıcı bildirimleri desteklemiyor. Telefonda Safari (ana ekrandan) ya da Chrome kullanın.</FormNotice>
      )}
      {status === "denied" && (
        <FormNotice>
          Bildirim izni kapalı. Telefonun ayarlarından Fabrikadann Yönetim için bildirimlere izin verin, sonra sayfayı yenileyin.
        </FormNotice>
      )}
      {status === "off" && (
        <div className="flex flex-col gap-2">
          <p className="text-[0.8125rem]">Bu cihazda bildirimler kapalı.</p>
          <Button type="button" onClick={enable} disabled={busy} className="w-full sm:w-auto">
            {busy ? "Açılıyor…" : "Bu cihazda bildirimleri aç"}
          </Button>
        </div>
      )}
      {status === "on" && (
        <div className="flex flex-col gap-2">
          <p className="text-[0.8125rem]">Bu cihazda bildirimler açık.</p>
          <Button type="button" variant="secondary" onClick={disable} disabled={busy} className="w-full sm:w-auto">
            {busy ? "Kapatılıyor…" : "Bu cihazda bildirimleri kapat"}
          </Button>
        </div>
      )}
    </div>
  );
}
