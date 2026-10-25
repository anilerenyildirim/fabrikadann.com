import { expect, test } from "vitest";
import { formatPrice, parsePriceToKurus } from "@/lib/money";
import { slugify } from "@/lib/slug";
import { trLower, trUpper } from "@/lib/text";

test("fiyat tr-TR biçiminde gösterilir", () => {
  expect(formatPrice(129990)).toBe("1.299,90 TL");
  expect(formatPrice(5000)).toBe("50,00 TL");
  expect(formatPrice(0)).toBe("0,00 TL");
});

test("girilen fiyat kuruşa çevrilir", () => {
  expect(parsePriceToKurus("1.299,90")).toBe(129990);
  expect(parsePriceToKurus("1299,9")).toBe(129990);
  expect(parsePriceToKurus("1299")).toBe(129900);
  expect(parsePriceToKurus(" 49,99 TL ")).toBe(4999);
  expect(parsePriceToKurus("abc")).toBeNaN();
  expect(parsePriceToKurus("-5")).toBeNaN();
  expect(parsePriceToKurus("1,999")).toBeNaN();
});

test("Türkçe karakterli slug", () => {
  expect(slugify("Şık Çizme İĞÜ")).toBe("sik-cizme-igu");
  expect(slugify("  Deri   Loafer — Siyah! ")).toBe("deri-loafer-siyah");
  expect(slugify("ıöç")).toBe("ioc");
});

test("Türkçe büyük/küçük harf", () => {
  expect(trLower("AYAKKABI İNCE")).toBe("ayakkabı ince");
  expect(trUpper("ince ayakkabı")).toBe("İNCE AYAKKABI");
});

test("kontrol karakterleri temizlenir, satır sonu kalır", async () => {
  const { stripControl } = await import("@/lib/text");
  const { parseListingParams } = await import("@/lib/listing");
  expect(stripControl(`a${String.fromCharCode(0)}b${String.fromCharCode(27)}c\nd`)).toBe("abc\nd");
  expect(parseListingParams({ q: `bo${String.fromCharCode(0)}t` }).q).toBe("bot");
});
