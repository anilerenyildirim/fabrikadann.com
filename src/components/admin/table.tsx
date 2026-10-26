import type { ReactNode } from "react";

/** Tablolar mobilde kendi kutusunda yatay kayar; sayfa kaymaz. */
export function TableWrap({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      className="-mx-4 overflow-x-auto overscroll-x-contain px-4 md:mx-0 md:px-0"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

export const th = "label whitespace-nowrap border-b border-ink py-2 pr-4 text-left font-normal text-graphite last:pr-0";
export const td = "border-b border-rule py-2.5 pr-4 align-middle last:pr-0";
export const table = "w-full border-collapse text-[0.8125rem]";
