"use client";

import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";
import { useEffect } from "react";
import { Wordmark } from "@/components/brand/Logo";
import { StatusView } from "@/components/home/StatusView";
import { buttonClass } from "@/components/ui/form";

/** Kök düzen de çöktüğünde: kendi html/body'si ile en sade sayfa. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <html lang="tr">
      <body>
        <title>Bir sorun oluştu — fabrikadann</title>
        <header className="flex h-14 items-center px-4 md:h-16 md:px-6">
          {/* Uygulama çöktüğü için tam sayfa yükleme */}
          <a href="/" className="flex min-h-11 items-center" aria-label="fabrikadann ana sayfa">
            <Wordmark className="h-[13px] w-auto md:h-[17px]" />
          </a>
        </header>
        <main>
          <StatusView
            eyebrow="Hata"
            title="Site şu an açılamıyor"
            actions={
              <>
                <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
                  Yeniden dene
                </button>
                <a href="/" className={buttonClass("secondary")}>
                  Ana sayfaya dön
                </a>
              </>
            }
            footnote={digest ? <>Hata kodu: {digest}</> : undefined}
          >
            <p>Beklenmeyen bir sorun oluştu. Birkaç dakika sonra yeniden deneyin.</p>
          </StatusView>
        </main>
      </body>
    </html>
  );
}
