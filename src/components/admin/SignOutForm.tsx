"use client";

import type { ReactNode } from "react";
import { currentPushSubscription } from "./PushRegistration";

/** Çıkışta bu tarayıcının bildirim aboneliği de kapanır (sunucuda yalnızca bu kullanıcıya aitse silinir). */
export function SignOutForm({
  action,
  className,
  children,
}: {
  action: (form: FormData) => Promise<void>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      className={className}
      action={async (form) => {
        const sub = await currentPushSubscription().catch(() => null);
        if (sub) {
          form.set("endpoint", sub.endpoint);
          await sub.unsubscribe().catch(() => false);
        }
        await action(form);
      }}
    >
      {children}
    </form>
  );
}
