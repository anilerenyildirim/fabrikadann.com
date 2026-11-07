import { expect, test } from "vitest";
import type { N11Attribute } from "@/server/marketplaces/n11/client";
import { buildSkus, isNationalBarcode, n11PriceOf, type ListingInput } from "@/server/marketplaces/n11/listing";

const attrs: N11Attribute[] = [
  { id: 1, name: "Marka", mandatory: true, variant: false, slicer: false, custom: true, values: [{ id: 50, value: "Abel" }] },
  { id: 22, name: "Cinsiyet", mandatory: true, variant: false, slicer: false, custom: false, values: [{ id: 7, value: "Kadın" }] },
  { id: 429, name: "Renk", mandatory: true, variant: false, slicer: true, custom: true, values: [{ id: 91, value: "Siyah" }] },
  {
    id: 847,
    name: "Numara",
    mandatory: true,
    variant: true,
    slicer: false,
    custom: false,
    values: [
      { id: 380, value: "38" },
      { id: 385, value: "38.5" },
      { id: 390, value: "39" },
    ],
  },
  { id: 1000000, name: "Kayıtlı Ticari Unvan", mandatory: false, variant: false, slicer: false, custom: true, values: [] },
  { id: 1000003, name: "E-posta", mandatory: false, variant: false, slicer: false, custom: true, values: [] },
];

function input(over: Partial<ListingInput> = {}): ListingInput {
  return {
    product: {
      id: "p-1",
      name: "Hakiki Deri Bot",
      description: "Rahat kalıp.\n\nFermuarlı <b>bot</b>.",
      price: 100000,
      n11Price: null,
      colors: [
        {
          name: "Siyah",
          images: ["p/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
          variants: [
            { sku: "BOT-S-38", size: "38", stock: 3, barcode: "8680000000013" },
            { sku: "BOT-S-385", size: "38,5", stock: 0, barcode: "2900000000014" },
          ],
        },
      ],
    },
    mapping: { externalCategoryId: 1001799, attributes: [{ id: 22, name: "Cinsiyet", valueId: 7, customValue: null }] },
    attributes: attrs,
    settings: { n11PricePercent: 33, n11PreparingDay: 2, n11VatRate: 10, n11ShipmentTemplate: "STANDART", n11Brand: "Fabrikadann" },
    company: { name: "Fabrikadann Ltd", address: "", email: "info@fabrikadann.com" },
    appUrl: "https://fabrikadann.com",
    ...over,
  };
}

test("fiyat: site fiyatı + %33 tam liraya yukarı; elle fiyat öncelikli", () => {
  expect(n11PriceOf(100000, null, 33)).toBe(133000);
  expect(n11PriceOf(99990, null, 33)).toBe(133000);
  expect(n11PriceOf(100000, 125050, 33)).toBe(125050);
});

test("ulusal barkod: geçerli EAN-13, 2 ile başlayan iç barkod değil", () => {
  expect(isNationalBarcode("8680000000013")).toBe(true);
  expect(isNationalBarcode("8680000000014")).toBe(false);
  expect(isNationalBarcode("2900000000014")).toBe(false);
  expect(isNationalBarcode(null)).toBe(false);
});

test("SKU alanları: başlık, açıklama HTML kaçışlı, fiyat, stok, görsel JPEG https", () => {
  const { skus, problems } = buildSkus(input());
  expect(problems).toEqual([]);
  expect(skus).toHaveLength(2);
  const [a, b] = skus;
  expect(a).toMatchObject({
    title: "Hakiki Deri Bot Siyah",
    categoryId: 1001799,
    currencyType: "TL",
    productMainId: "p-1",
    preparingDay: 2,
    shipmentTemplate: "STANDART",
    stockCode: "BOT-S-38",
    barcode: "8680000000013",
    quantity: 3,
    salePrice: 133000,
    listPrice: 133000,
    vatRate: 10,
    images: [{ url: "https://fabrikadann.com/medya/p/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-1200.jpg", order: 0 }],
  });
  expect(a!.description).toBe("<p>Rahat kalıp.</p><p>Fermuarlı &lt;b&gt;bot&lt;/b&gt;.</p>");
  expect(b!.barcode).toBeNull();
  expect(b!.quantity).toBe(0);
});

test("özellikler: sabit + marka + renk valueId + numara 38,5 → 38.5 + GPSR", () => {
  const { skus } = buildSkus(input());
  expect(skus[0]!.attributes).toEqual([
    { id: 22, valueId: 7, customValue: null },
    { id: 1, valueId: null, customValue: "Fabrikadann" },
    { id: 429, valueId: 91, customValue: null },
    { id: 847, valueId: 380, customValue: null },
    { id: 1000000, valueId: null, customValue: "Fabrikadann Ltd" },
    { id: 1000003, valueId: null, customValue: "info@fabrikadann.com" },
  ]);
  expect(skus[1]!.attributes.find((x) => x.id === 847)).toEqual({ id: 847, valueId: 385, customValue: null });
});

test("listede olmayan renk serbest metin; listede olmayan numara sorun", () => {
  const i = input();
  i.product.colors[0]!.name = "Taba";
  i.product.colors[0]!.variants[1]!.size = "45";
  const { skus, problems } = buildSkus(i);
  expect(skus).toHaveLength(1);
  expect(skus[0]!.attributes.find((x) => x.id === 429)).toEqual({ id: 429, valueId: null, customValue: "Taba" });
  expect(problems).toEqual([{ stockCode: "BOT-S-385", reason: "N11'de 45 numarası yok (Numara listesi)" }]);
});

test("zorunlu sabit özellik eksikse ürün gönderilmez", () => {
  const { skus, problems } = buildSkus(input({ mapping: { externalCategoryId: 1, attributes: [] } }));
  expect(skus).toEqual([]);
  expect(problems).toEqual([{ stockCode: null, reason: "Kategori eşleştirmesinde zorunlu özellik eksik: Cinsiyet" }]);
});

test("görselsiz renk ve https olmayan adres sorun", () => {
  const i = input();
  i.product.colors[0]!.images = [];
  expect(buildSkus(i).problems).toEqual([{ stockCode: null, reason: "Siyah renginin görseli yok" }]);
  expect(buildSkus(input({ appUrl: "http://localhost:3000" })).problems[0]!.reason).toMatch(/https/);
});

test("en fazla 8 görsel, başlık en fazla 100 karakter, renk adı başlıkta varsa tekrarlanmaz", () => {
  const i = input();
  i.product.name = "Siyah " + "Uzun ".repeat(30);
  i.product.colors[0]!.images = Array.from({ length: 10 }, (_, n) => `p/aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, "0")}`);
  const { skus } = buildSkus(i);
  expect(skus[0]!.images).toHaveLength(8);
  expect(skus[0]!.title.length).toBeLessThanOrEqual(100);
  expect(skus[0]!.title.endsWith(" Siyah")).toBe(false);
});

test("only verilirse yalnız o SKU'lar", () => {
  expect(buildSkus(input({ only: new Set(["BOT-S-385"]) })).skus.map((s) => s.stockCode)).toEqual(["BOT-S-385"]);
});

test("ürüne özel özellik kategori özelliğini ezer, yenisini ekler", () => {
  const i = input({
    attributes: [...attrs, { id: 7794, name: "Topuk Tipi", mandatory: false, variant: false, slicer: false, custom: true, values: [] }],
  });
  i.productAttributes = [
    { id: 22, name: "Cinsiyet", valueId: 7, customValue: null },
    { id: 7794, name: "Topuk Tipi", valueId: null, customValue: "Blok" },
  ];
  i.mapping.attributes = [{ id: 22, name: "Cinsiyet", valueId: 7, customValue: null }];
  const a = buildSkus(i).skus[0]!.attributes;
  expect(a.filter((x) => x.id === 22)).toHaveLength(1);
  expect(a).toContainEqual({ id: 7794, valueId: null, customValue: "Blok" });
});
