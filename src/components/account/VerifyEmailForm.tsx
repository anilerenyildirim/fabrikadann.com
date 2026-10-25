"use client";

import Link from "next/link";
import { useActionState } from "react";
import { verifyEmailAction } from "@/app/(magaza)/actions/auth";
import { Button, FormNotice } from "@/components/ui/form";
import type { FormState } from "@/lib/form";

export function VerifyEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyEmailAction, {});
  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <FormNotice>
          <p>{state.error}</p>
          <Link href="/giris" className="mt-1 inline-flex min-h-11 items-center underline underline-offset-4">
            Giriş yap
          </Link>
        </FormNotice>
      )}
      <Button type="submit" full disabled={pending} aria-disabled={pending}>
        {pending ? "Etkinleştiriliyor…" : "Hesabımı etkinleştir"}
      </Button>
    </form>
  );
}
