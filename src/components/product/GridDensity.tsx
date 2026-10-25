"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { cardImageSizes, DEFAULT_DENSITY, gridClass, type Density } from "./grid";

/*
  Izgara yoğunluğu tercihi ziyaretçinin tarayıcısında tutulur. localStorage erişilemezse
  (gizli pencere, engellenmiş site verisi) tercih yalnızca sayfa açıkken bellekte kalır.
*/
const STORAGE_KEY = "fd_izgara";
const DEFAULT_RAW = `${DEFAULT_DENSITY.mobile}-${DEFAULT_DENSITY.desktop}`;
const RAW_RE = /^[12]-[24]$/;

let memory: string | null = null;
const listeners = new Set<() => void>();

function readRaw(): string {
  if (memory) return memory;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && RAW_RE.test(stored)) return stored;
  } catch {
    // erişim yok: varsayılan
  }
  return DEFAULT_RAW;
}

function writeRaw(raw: string) {
  memory = raw;
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // yazılamadı: bellekteki değer yeter
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      memory = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function parse(raw: string): Density {
  const [m, d] = raw.split("-");
  return { mobile: m === "1" ? 1 : 2, desktop: d === "2" ? 2 : 4 };
}

function useDensity(): [Density, (next: Density) => void] {
  // Sunucuda ve hidrasyonda varsayılan; ardından kayıtlı tercih (hidrasyon hatası olmadan)
  const raw = useSyncExternalStore(subscribe, readRaw, () => DEFAULT_RAW);
  return [parse(raw), (next) => writeRaw(`${next.mobile}-${next.desktop}`)];
}

const noopSubscribe = () => () => {};

/** JavaScript yüklenmeden çalışmayacak denetimleri gizlemek için. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function DensityGrid({ children, label }: { children: ReactNode; label?: string }) {
  const [density] = useDensity();
  const listRef = useRef<HTMLUListElement>(null);

  // Kartlar sunucuda varsayılan yoğunluğa göre çiziliyor; tek sütunda görsel bulanık kalmasın diye
  // tarayıcıya gerçek genişlik bildirilir (sizes değişince uygun srcset adayı yeniden seçilir)
  const sizes = cardImageSizes(density);
  useEffect(() => {
    for (const img of listRef.current?.querySelectorAll("img") ?? []) {
      if (img.sizes !== sizes) img.sizes = sizes;
    }
  }, [sizes, children]);

  return (
    <ul ref={listRef} className={gridClass(density)} aria-label={label}>
      {children}
    </ul>
  );
}

export function DensityToggle() {
  const [density, setDensity] = useDensity();
  const hydrated = useHydrated();
  if (!hydrated) return null;
  return (
    <div role="group" aria-label="Izgara görünümü" className="flex items-center">
      <div className="flex md:hidden">
        <DensityButton
          cols={1}
          label="Tek sütun"
          pressed={density.mobile === 1}
          onClick={() => setDensity({ ...density, mobile: 1 })}
        />
        <DensityButton
          cols={2}
          label="İki sütun"
          pressed={density.mobile === 2}
          onClick={() => setDensity({ ...density, mobile: 2 })}
        />
      </div>
      <div className="hidden md:flex">
        <DensityButton
          cols={2}
          label="İki sütun"
          pressed={density.desktop === 2}
          onClick={() => setDensity({ ...density, desktop: 2 })}
        />
        <DensityButton
          cols={4}
          label="Dört sütun"
          pressed={density.desktop === 4}
          onClick={() => setDensity({ ...density, desktop: 4 })}
        />
      </div>
    </div>
  );
}

function DensityButton({
  cols,
  label,
  pressed,
  onClick,
}: {
  cols: 1 | 2 | 4;
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex min-h-11 min-w-11 items-center justify-center transition-colors ${pressed ? "text-ink" : "text-ash hover:text-ink"}`}
    >
      <ColumnsIcon cols={cols} />
    </button>
  );
}

function ColumnsIcon({ cols }: { cols: 1 | 2 | 4 }) {
  const gap = 2;
  const width = (20 - gap * (cols - 1)) / cols;
  return (
    <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden="true">
      {Array.from({ length: cols }, (_, i) => (
        <rect key={i} x={i * (width + gap)} y={cols === 4 ? 6 : 2} width={width} height={cols === 4 ? 8 : 16} fill="currentColor" />
      ))}
    </svg>
  );
}
