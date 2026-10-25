import Link from "next/link";
import type { ReactNode } from "react";
import { Monogram } from "@/components/brand/Logo";

/** Giriş ve iki adımlı doğrulama sayfalarının sade çerçevesi. */
export function AuthShell({ step, title, children, footer }: { step: string; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main id="icerik" className="flex min-h-svh flex-col px-4 py-10">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <Link href="/" className="mb-14 inline-flex min-h-11 items-center self-start" aria-label="fabrikadann vitrin">
          <Monogram className="h-6 w-auto" />
        </Link>
        <p className="label text-graphite">Yönetim · {step}</p>
        <h1 className="wide mt-2 mb-10 text-lg">{title}</h1>
        {children}
        {footer && <div className="mt-10 text-[0.8125rem] text-graphite">{footer}</div>}
      </div>
    </main>
  );
}
