"use client";

import Form from "next/form";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/form";
import { SORT_LABELS, type SortParam } from "@/lib/listing";

type Props = {
  /** Formun gönderileceği sayfa (ör. /urunler, /kategori/bot) */
  action: string;
  sizes: string[];
  selectedSizes: string[];
  sort: SortParam;
  clearHref: string;
};

/**
 * Numara ve sıralama paneli. details/summary + GET formu: JavaScript olmadan da açılır ve çalışır;
 * JavaScript varsa next/form sayfayı yenilemeden geçer.
 */
export function FilterPanel({ action, sizes, selectedSizes, sort, clearHref }: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const active = selectedSizes.length + (sort !== "yeni" ? 1 : 0);

  const close = () => {
    if (detailsRef.current) detailsRef.current.open = false;
  };

  // Panelin dışına dokununca kapanır (ürün ızgarasının üstünü örtmesin)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && e.target instanceof Node && !details.contains(e.target)) details.open = false;
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <details
      ref={detailsRef}
      className="group"
      onKeyDown={(e) => {
        if (e.key === "Escape" && detailsRef.current?.open) {
          close();
          summaryRef.current?.focus();
        }
      }}
    >
      <summary
        ref={summaryRef}
        className="label flex min-h-11 cursor-pointer list-none items-center gap-2 px-2 [&::-webkit-details-marker]:hidden"
      >
        Filtrele ve sırala
        {active > 0 && <span className="tabular">({active})</span>}
        <svg
          viewBox="0 0 10 6"
          className="size-2.5 transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path d="M0 0l5 6 5-6" />
        </svg>
      </summary>

      <div className="absolute inset-x-0 top-full max-h-[calc(100svh-7.5rem)] overflow-y-auto border-b border-rule bg-paper px-4 pb-8 pt-6 md:px-6">
        <Form action={action} onSubmit={close} className="mx-auto max-w-3xl">
          {sizes.length > 0 && (
            <fieldset>
              <legend className="label text-graphite">Numara</legend>
              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1">
                {sizes.map((size) => (
                  <label key={size} className="relative cursor-pointer">
                    <input
                      type="checkbox"
                      name="numara"
                      value={size}
                      defaultChecked={selectedSizes.includes(size)}
                      className="peer sr-only"
                    />
                    <span className="tabular flex min-h-11 items-center justify-center border border-rule text-[0.8125rem] transition-colors hover:border-ink peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
                      {size}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className={sizes.length > 0 ? "mt-8" : ""}>
            <legend className="label text-graphite">Sırala</legend>
            <div className="mt-2">
              {(Object.keys(SORT_LABELS) as SortParam[]).map((key) => (
                <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="sirala"
                    value={key}
                    defaultChecked={sort === key}
                    className="size-[18px] shrink-0 cursor-pointer appearance-none rounded-full border border-ink bg-paper checked:border-[5px]"
                  />
                  <span className="text-[0.8125rem]">{SORT_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-2">
            <Button type="submit">Sonuçları göster</Button>
            {active > 0 && (
              <Link href={clearHref} className="label inline-flex min-h-11 items-center underline underline-offset-4">
                Filtreleri temizle
              </Link>
            )}
          </div>
        </Form>
      </div>
    </details>
  );
}
