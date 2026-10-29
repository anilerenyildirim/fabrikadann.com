// EAN-13 kodlaması: 95 modüllük çubuk dizisi (1 = siyah). Etiket yazdırmada SVG'ye çevrilir.

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R = L.map((code) => [...code].map((b) => (b === "1" ? "0" : "1")).join(""));
const G = R.map((code) => [...code].reverse().join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function ean13CheckDigit(first12: string): number {
  const sum = [...first12].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Geçerli EAN-13 için modül dizisi; geçersizse null. */
export function ean13Modules(code: string): string | null {
  if (!isValidEan13(code)) return null;
  const d = [...code].map(Number);
  const parity = PARITY[d[0]!]!;
  let out = "101";
  for (let i = 1; i <= 6; i++) out += (parity[i - 1] === "L" ? L : G)[d[i]!];
  out += "01010";
  for (let i = 7; i <= 12; i++) out += R[d[i]!];
  return out + "101";
}
