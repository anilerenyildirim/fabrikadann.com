"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Mobilde yatay kaydırılan görsel şeridi (scroll-snap) ve "1 / 4" sayacı;
 * masaüstünde aynı liste iki sütunlu ızgaraya döner.
 */
export function GalleryRail({ count, label, children }: { count: number; label: string; children: ReactNode }) {
  const railRef = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const i = Math.round(rail.scrollLeft / Math.max(1, rail.clientWidth));
        setIndex(Math.min(Math.max(i, 0), count - 1));
      });
    };
    rail.addEventListener("scroll", update, { passive: true });
    return () => {
      rail.removeEventListener("scroll", update);
      cancelAnimationFrame(frame);
    };
  }, [count]);

  return (
    <div className="relative">
      <ul
        ref={railRef}
        aria-label={label}
        className="rail md:grid md:snap-none md:grid-cols-1 md:gap-0.5 md:overflow-visible lg:grid-cols-2"
      >
        {children}
      </ul>
      {count > 1 && (
        <p
          className="label tabular pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 bg-paper/80 px-2 py-0.5 md:hidden"
          aria-hidden="true"
        >
          {index + 1} / {count}
        </p>
      )}
    </div>
  );
}
