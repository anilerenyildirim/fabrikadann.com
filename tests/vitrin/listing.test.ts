import { describe, expect, test } from "vitest";
import {
  isSlug,
  isUuid,
  listingHref,
  MAX_SIZES,
  pageCount,
  parseListingParams,
  SORTS,
} from "@/lib/listing";

describe("parseListingParams", () => {
  test("parametre yoksa varsayılanlar", () => {
    expect(parseListingParams({})).toEqual({ sizes: [], sort: "yeni", page: 1, q: "" });
  });

  test("tek ve çoklu numara", () => {
    expect(parseListingParams({ numara: "40" }).sizes).toEqual(["40"]);
    expect(parseListingParams({ numara: ["40", "41", "38.5", "39,5"] }).sizes).toEqual(["40", "41", "38.5", "39,5"]);
  });

  test("geçersiz numaralar yok sayılır, tekrarlar bir kez alınır", () => {
    const { sizes } = parseListingParams({
      numara: ["40", "40", "", " 41 ", "abc", "<script>", "123", "40.55", "4", "40;drop"],
    });
    expect(sizes).toEqual(["40", "41", "4"]);
  });

  test(`en fazla ${MAX_SIZES} numara`, () => {
    const many = Array.from({ length: 50 }, (_, i) => String(i + 10));
    const { sizes } = parseListingParams({ numara: many });
    expect(sizes).toHaveLength(MAX_SIZES);
    expect(sizes[0]).toBe("10");
  });

  test("sıralama", () => {
    expect(parseListingParams({ sirala: "artan" }).sort).toBe("artan");
    expect(parseListingParams({ sirala: "azalan" }).sort).toBe("azalan");
    expect(parseListingParams({ sirala: "yeni" }).sort).toBe("yeni");
    expect(parseListingParams({ sirala: ["azalan", "artan"] }).sort).toBe("azalan");
  });

  test("geçersiz sıralama varsayılana döner", () => {
    for (const bad of ["", "ARTAN", "price_asc", "toString", "__proto__", "constructor", "hasOwnProperty"]) {
      expect(parseListingParams({ sirala: bad }).sort).toBe("yeni");
    }
  });

  test("sıralama servis anahtarına eşlenir", () => {
    expect(SORTS.yeni).toBe("new");
    expect(SORTS.artan).toBe("price_asc");
    expect(SORTS.azalan).toBe("price_desc");
  });

  test("sayfa 1..1000 arasında tam sayı", () => {
    expect(parseListingParams({ sayfa: "2" }).page).toBe(2);
    expect(parseListingParams({ sayfa: "1000" }).page).toBe(1000);
    expect(parseListingParams({ sayfa: ["3", "4"] }).page).toBe(3);
  });

  test("geçersiz sayfa 1 olur", () => {
    for (const bad of ["0", "-1", "1001", "99999", "2.5", "1e3", "abc", "", " ", "0x10", "Infinity", "NaN"]) {
      expect(parseListingParams({ sayfa: bad }).page).toBe(1);
    }
  });

  test("arama metni kırpılır, boşluklar sadeleşir, 80 karakterle sınırlanır", () => {
    expect(parseListingParams({ q: "  deri   sneaker  " }).q).toBe("deri sneaker");
    expect(parseListingParams({ q: ["bot", "loafer"] }).q).toBe("bot");
    expect(parseListingParams({ q: "a".repeat(200) }).q).toHaveLength(80);
    expect(parseListingParams({ q: "\n\t" }).q).toBe("");
  });
});

describe("listingHref", () => {
  test("varsayılanlar yazılmaz", () => {
    expect(listingHref("/urunler")).toBe("/urunler");
    expect(listingHref("/urunler", { sort: "yeni", page: 1, sizes: [], q: "" })).toBe("/urunler");
  });

  test("parametreler sırayla ve kodlanarak yazılır", () => {
    expect(listingHref("/kategori/bot", { sizes: ["40", "41"], sort: "artan", page: 2 })).toBe(
      "/kategori/bot?numara=40&numara=41&sirala=artan&sayfa=2",
    );
    expect(listingHref("/ara", { q: "süet bot & çizme", page: 3 })).toBe("/ara?q=s%C3%BCet+bot+%26+%C3%A7izme&sayfa=3");
  });

  test("ayrıştırma ile gidiş-dönüş", () => {
    const query = { sizes: ["38.5", "40"], sort: "azalan" as const, page: 4, q: "" };
    const href = listingHref("/urunler", query);
    const params = Object.fromEntries(
      [...new URL(href, "http://x").searchParams.keys()].map((k) => [k, new URL(href, "http://x").searchParams.getAll(k)]),
    );
    expect(parseListingParams(params)).toEqual(query);
  });
});

test("sayfa sayısı", () => {
  expect(pageCount(0, 24)).toBe(1);
  expect(pageCount(24, 24)).toBe(1);
  expect(pageCount(25, 24)).toBe(2);
});

test("UUID ve slug doğrulaması", () => {
  expect(isUuid("3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b")).toBe(true);
  expect(isUuid("3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5")).toBe(false);
  expect(isUuid("' OR 1=1 --")).toBe(false);
  expect(isUuid(undefined)).toBe(false);
  expect(isSlug("deri-sneaker")).toBe(true);
  expect(isSlug("deri-sneaker-2")).toBe(true);
  expect(isSlug("Deri-Sneaker")).toBe(false);
  expect(isSlug("../etc")).toBe(false);
  expect(isSlug("-a")).toBe(false);
  expect(isSlug("a".repeat(121))).toBe(false);
});
