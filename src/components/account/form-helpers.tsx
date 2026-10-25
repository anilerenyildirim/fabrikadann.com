"use client";

import { useEffect, useRef } from "react";
import { FormNotice } from "@/components/ui/form";
import type { FormState } from "@/lib/form";

/** Sunucudan alan hatası dönünce ilk hatalı alana odaklanır (klavye ve ekran okuyucu için). */
export function useFocusFirstError(state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.fieldErrors) return;
    ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);
  return ref;
}

/** Formun üstündeki genel hata ya da başarı mesajı. */
export function StateNotice({ state, children }: { state: FormState; children?: React.ReactNode }) {
  if (state.error) {
    return (
      <FormNotice>
        {state.error}
        {children}
      </FormNotice>
    );
  }
  if (state.ok && state.message) return <FormNotice tone="info">{state.message}</FormNotice>;
  return null;
}
