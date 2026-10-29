import Link from "next/link";
import { qs } from "./ui";

const monthName = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const s = monthName.format(new Date(Date.UTC(y, m - 1, 1)));
  return s.charAt(0).toLocaleUpperCase("tr") + s.slice(1);
}

/** Önceki / sonraki ay bağlantıları (JS gerekmez). */
export function MonthNav({
  base,
  month,
  current,
  extra = {},
}: {
  base: string;
  month: string;
  current: string;
  extra?: Record<string, string | undefined>;
}) {
  const btn = "label inline-flex min-h-11 min-w-11 items-center justify-center border border-rule px-3 hover:border-ink";
  return (
    <nav aria-label="Dönem" className="mb-8 flex flex-wrap items-center gap-2">
      <Link href={qs(base, { ...extra, ay: shiftMonth(month, -1) })} className={btn} aria-label="Önceki ay">
        ←
      </Link>
      <span className="wide min-w-40 px-2 text-center text-sm">{monthLabel(month)}</span>
      {month < current ? (
        <Link href={qs(base, { ...extra, ay: shiftMonth(month, 1) })} className={btn} aria-label="Sonraki ay">
          →
        </Link>
      ) : (
        <span className={`${btn} text-ash`} aria-hidden="true">
          →
        </span>
      )}
      {month !== current && (
        <Link href={qs(base, extra)} className="label inline-flex min-h-11 items-center px-2 text-graphite underline underline-offset-4">
          Bu ay
        </Link>
      )}
    </nav>
  );
}
