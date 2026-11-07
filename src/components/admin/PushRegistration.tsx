"use client";

import { useEffect } from "react";

/** Panel açılınca bildirim service worker'ını kaydeder (yalnızca /yonetim/ kapsamı). */
export function PushRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/yonetim/sw.js", { scope: "/yonetim/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/yonetim/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}
