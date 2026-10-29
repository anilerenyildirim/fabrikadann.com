import { describe, expect, test } from "vitest";
import { csvCell, csvMoney, toCsv } from "@/lib/csv";

describe("CSV", () => {
  test("formül enjeksiyonu engellenir, sayı biçimi korunur, tırnaklama", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM")).toBe("'@SUM");
    expect(csvCell("-12,50")).toBe("-12,50");
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell('a;"b"')).toBe('"a;""b"""');
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
  });

  test("tutar ve dosya", () => {
    expect(csvMoney(123450)).toBe("1234,50");
    expect(csvMoney(-5)).toBe("-0,05");
    expect(toCsv(["A", "B"], [[1, "x"]])).toBe("﻿A;B\r\n1;x\r\n");
  });
});
