"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Panelde beklenmeyen hata: ayrıntı gösterilmez (sunucu kayıtlarında), yeniden deneme sunulur. */
export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <div className="max-w-lg py-10" role="alert">
      <p className="label text-graphite">Hata</p>
      <h1 className="wide mt-2 text-lg">Sayfa yüklenemedi</h1>
      <p className="mt-4 text-[0.8125rem] text-graphite">
        Beklenmeyen bir sorun oluştu. Yeniden deneyin; sürerse sunucu kayıtlarına bakın.
      </p>
      {digest && (
        <p className="mt-2 text-[0.75rem] text-graphite">
          Hata kodu: <span className="tabular">{digest}</span>
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-4">
        <button
          type="button"
          onClick={() => retry()}
          className="label inline-flex min-h-11 items-center bg-ink px-6 text-paper hover:bg-night"
        >
          Yeniden dene
        </button>
        <Link href="/yonetim" className="label inline-flex min-h-11 items-center border border-ink px-6 hover:bg-fog">
          Panoya dön
        </Link>
      </div>
    </div>
  );
}
