"use client";

import { useActionState } from "react";
import { retryPayment } from "@/app/(magaza)/siparis/[number]/actions";
import { Button, FormNotice } from "@/components/ui/form";
import type { FormState } from "@/lib/form";

const initial: FormState = {};

export function RetryPaymentForm({ number }: { number: string }) {
  const [state, action, pending] = useActionState(retryPayment, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="number" value={number} />
      {state.error && <FormNotice>{state.error}</FormNotice>}
      <Button type="submit" full disabled={pending} className="sm:w-auto sm:min-w-64">
        {pending ? "Ödeme sayfası açılıyor…" : "Ödemeyi tamamla"}
      </Button>
    </form>
  );
}
