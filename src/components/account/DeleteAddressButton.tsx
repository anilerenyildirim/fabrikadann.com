"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteAddressAction } from "@/app/(magaza)/actions/account";
import { Button } from "@/components/ui/form";

/** Silme iki adımlı: önce sorulur, onaylanınca silinir. */
export function DeleteAddressButton({ id, title }: { id: string; title: string }) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (confirming) {
      opened.current = true;
      confirmRef.current?.focus();
    } else if (opened.current) {
      triggerRef.current?.focus();
    }
  }, [confirming]);

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="quiet"
        onClick={() => setConfirming(true)}
        aria-label={`${title} adresini sil`}
      >
        Sil
      </Button>
    );
  }

  return (
    <form action={deleteAddressAction} className="flex w-full flex-wrap items-center gap-x-6 gap-y-2" role="group" aria-label={`${title} adresini silme onayı`}>
      <input type="hidden" name="id" value={id} />
      <p className="w-full text-[0.8125rem]">Bu adres silinsin mi?</p>
      <ConfirmButton ref={confirmRef} />
      <Button type="button" variant="quiet" onClick={() => setConfirming(false)}>
        Vazgeç
      </Button>
    </form>
  );
}

function ConfirmButton({ ref }: { ref: React.Ref<HTMLButtonElement> }) {
  const { pending } = useFormStatus();
  return (
    <Button ref={ref} type="submit" variant="secondary" disabled={pending} aria-disabled={pending} className="min-h-11 px-5">
      {pending ? "Siliniyor…" : "Evet, sil"}
    </Button>
  );
}
