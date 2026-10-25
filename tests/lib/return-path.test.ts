import { expect, test } from "vitest";
import { safeReturnPath } from "@/lib/form";

const BACKSLASH = String.fromCharCode(92);

test("dönüş adresi yalnızca site içi göreli yol", () => {
  expect(safeReturnPath("/odeme")).toBe("/odeme");
  expect(safeReturnPath("/urun/deri-sneaker?renk=1#x")).toBe("/urun/deri-sneaker?renk=1#x");
  expect(safeReturnPath("/%0d%0a")).toBe("/%0d%0a");
  const bad = [
    "//evil.com",
    `/${BACKSLASH}evil.com`,
    "/\t/evil.com",
    "/\n/evil.com",
    "https://evil.com",
    "evil.com",
    "",
    null,
    undefined,
    `/${"a".repeat(400)}`,
  ];
  for (const value of bad) expect(safeReturnPath(value), JSON.stringify(value)).toBe("/hesabim");
});
