import type { ReactNode } from "react";

/** Açılır bölüm (details/summary): JavaScript gerektirmez, klavyeyle açılır. */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group border-b border-rule">
      <summary className="label flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        {title}
        <svg viewBox="0 0 12 12" className="size-3 shrink-0" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M0 6h12" />
          <path d="M6 0v12" className="group-open:hidden" />
        </svg>
      </summary>
      <div className="space-y-2 pb-6 text-[0.8125rem] leading-relaxed text-graphite">{children}</div>
    </details>
  );
}
