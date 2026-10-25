"use client";

import { useEffect } from "react";
import { StatusView } from "@/components/home/StatusView";
import { Button, ButtonLink } from "@/components/ui/form";

/** Mağaza sayfalarında beklenmeyen hata. Ayrıntı gösterilmez; yalnızca sunucu günlüğüyle eşleşen kod. */
export default function StoreError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <StatusView
      eyebrow="Hata"
      title="Sayfa açılamadı"
      actions={
        <>
          <Button type="button" onClick={() => retry()}>
            Yeniden dene
          </Button>
          <ButtonLink href="/" variant="secondary">
            Ana sayfaya dön
          </ButtonLink>
        </>
      }
      footnote={digest ? <>Hata kodu: {digest}</> : undefined}
    >
      <p>Beklenmeyen bir sorun oluştu. Yeniden deneyin; düzelmezse birkaç dakika sonra tekrar gelin.</p>
    </StatusView>
  );
}
