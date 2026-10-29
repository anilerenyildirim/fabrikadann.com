import { describe, expect, test } from "vitest";
import { ean13CheckDigit, ean13Modules, isValidEan13 } from "@/lib/ean13";

describe("EAN-13", () => {
  test("kontrol hanesi", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(ean13CheckDigit("290000000001")).toBe(8);
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan13("29000000000")).toBe(false);
  });

  test("modül dizisi: 95 modül, koruma çubukları, bilinen kod", () => {
    const m = ean13Modules("4006381333931")!;
    expect(m).toHaveLength(95);
    expect(m.slice(0, 3)).toBe("101");
    expect(m.slice(45, 50)).toBe("01010");
    expect(m.slice(92)).toBe("101");
    // İlk rakam 4 → sol yarı LGLLGG; ikinci rakam 0 L ile: 0001101
    expect(m.slice(3, 10)).toBe("0001101");
    // Üçüncü rakam 0 G ile: 0100111
    expect(m.slice(10, 17)).toBe("0100111");
    // Sağ yarının son rakamı 1, R kodu: 1100110
    expect(m.slice(85, 92)).toBe("1100110");
    expect(ean13Modules("123")).toBeNull();
  });
});
