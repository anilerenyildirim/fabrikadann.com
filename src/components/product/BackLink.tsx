"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type MouseEvent } from "react";

// Bu belge içinde sitede sayfa değiştirildi mi (istemci tarafı gezinmede document.referrer güncellenmez)
let firstPath: string | null = null;
let navigatedInApp = false;

/** Site başlığında çağrılır: ilk yolu kaydeder, sonraki her yol değişikliğinde iç gezinme var sayar. */
export function useTrackNavigation(pathname: string) {
  useEffect(() => {
    if (firstPath === null) firstPath = pathname;
    else if (pathname !== firstPath) navigatedInApp = true;
  }, [pathname]);
}

/**
 * Telefonda ürün sayfasının üstündeki "Geri" bağlantısı. Siteden gelindiyse tarayıcı geçmişine döner
 * (liste konumu ve filtreler korunur); doğrudan açıldıysa `href`'e (kategori ya da tüm ürünler) gider.
 */
export function BackLink({ href, className = "" }: { href: string; className?: string }) {
  const router = useRouter();

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    let fromSite = navigatedInApp;
    try {
      fromSite ||= document.referrer !== "" && new URL(document.referrer).origin === window.location.origin;
    } catch {}
    if (fromSite && window.history.length > 1) {
      e.preventDefault();
      router.back();
    }
  }

  return (
    <Link href={href} onClick={onClick} className={`group label inline-flex min-h-11 items-center gap-2 ${className}`}>
      <span aria-hidden className="transition-transform duration-200 ease-(--ease-cut) group-hover:-translate-x-1">
        ←
      </span>
      Geri
    </Link>
  );
}
