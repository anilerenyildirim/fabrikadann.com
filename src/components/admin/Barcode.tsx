import { ean13Modules } from "@/lib/ean13";

/** EAN-13 barkodu (SVG). Koruma çubukları uzun, rakamlar altta. */
export function Ean13({ code, className = "" }: { code: string; className?: string }) {
  const modules = ean13Modules(code);
  if (!modules) return <span className="tabular">{code}</span>;
  // Sol ve sağda 11 / 7 modül sessiz bölge; ilk rakam sessiz bölgeye yazılır
  const left = 11;
  const width = left + 95 + 7;
  const guard = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  const bars: { x: number; w: number; long: boolean }[] = [];
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] !== "1") continue;
    const long = guard.has(i);
    const last = bars.at(-1);
    if (last && last.x + last.w === left + i && last.long === long) last.w += 1;
    else bars.push({ x: left + i, w: 1, long });
  }
  const digit = (ch: string, x: number) => (
    <text x={x} y={66} fontSize={9} textAnchor="middle" fontFamily="inherit">
      {ch}
    </text>
  );
  return (
    <svg viewBox={`0 0 ${width} 68`} className={className} role="img" aria-label={`Barkod ${code}`} shapeRendering="crispEdges">
      <rect width={width} height={68} fill="var(--color-paper)" />
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={b.long ? 62 : 56} fill="var(--color-ink)" />
      ))}
      {digit(code[0]!, 5)}
      {[...code.slice(1, 7)].map((c, i) => (
        <g key={`l${i}`}>{digit(c, left + 3 + i * 7 + 3.5)}</g>
      ))}
      {[...code.slice(7)].map((c, i) => (
        <g key={`r${i}`}>{digit(c, left + 50 + i * 7 + 3.5)}</g>
      ))}
    </svg>
  );
}
