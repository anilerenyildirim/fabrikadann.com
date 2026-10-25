"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { COOKIE_NOTICE_KEY } from "@/components/legal/cookies";

/*
  Yalnızca zorunlu çerez kullanıldığı için onay değil bilgilendirme bandı. Kapatma tercihi
  localStorage'da; erişilemezse (gizli pencere, engellenmiş site verisi) bant yine kapanır,
  yalnızca bir sonraki ziyarette tekrar görünür.
*/
export function CookieNotice() {
  // Sunucuda ve ilk çizimde gizli: tercih yalnızca tarayıcıda okunabilir
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(COOKIE_NOTICE_KEY) === "1";
    } catch {
      // erişim yok: bildirimi göster
    }
    if (!dismissed) setVisible(true);
  }, []);

  if (!visible) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_KEY, "1");
    } catch {
      // kaydedilemese de kapansın
    }
    setVisible(false);
  }

  return (
    <section
      aria-label="Çerez bildirimi"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:bottom-4 sm:left-4 sm:max-w-sm sm:border sm:pb-0"
    >
      <div className="flex items-center gap-3 py-1 pl-4 pr-1 sm:py-2">
        <p className="flex-1 text-[0.75rem] leading-snug">
          Sitemiz yalnızca çalışması için gerekli çerezleri kullanır.{" "}
          {/* Dikey dolgu + eksi kenar boşluğu: satır yüksekliği değişmeden 44px dokunma alanı */}
          <Link
            href="/cerez-politikasi"
            className="-my-3.5 inline-block whitespace-nowrap py-3.5 underline underline-offset-2"
          >
            Çerez politikası
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="label flex min-h-11 min-w-11 shrink-0 items-center justify-center px-3 hover:underline hover:underline-offset-4"
        >
          Tamam
        </button>
      </div>
    </section>
  );
}
