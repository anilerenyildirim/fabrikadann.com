import { expect, test } from "vitest";
import { N11Client, N11Error, n11Config, type N11Sku } from "@/server/marketplaces/n11/client";

const cfg = { apiKey: "anahtar-123", apiSecret: "gizli-456", baseUrl: "https://api.n11.com" };

type Call = { url: string; init: RequestInit };
function fake(handler: (u: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(new URL(url), init);
  };
  return { calls, client: new N11Client(cfg, fetchImpl) };
}

test("ortam: ikisi birlikte; yoksa kapalı", () => {
  expect(n11Config({})).toBeNull();
  expect(() => n11Config({ N11_API_KEY: "a" })).toThrow(N11Error);
  expect(n11Config({ N11_API_KEY: "a", N11_API_SECRET: "b" })?.baseUrl).toBe("https://api.n11.com");
});

test("başlıklar appkey/appsecret; adres api.n11.com; yönlendirme izlenmez", async () => {
  const { calls, client } = fake(() => Response.json({ categories: [] }));
  await client.categories();
  const h = calls[0]!.init.headers as Record<string, string>;
  expect(calls[0]!.url).toBe("https://api.n11.com/cdn/categories");
  expect(h.appkey).toBe("anahtar-123");
  expect(h.appsecret).toBe("gizli-456");
  expect(calls[0]!.init.redirect).toBe("error");
});

test("hata mesajında sır yok, N11 mesajı var", async () => {
  const { client } = fake(() => new Response(JSON.stringify({ message: "Yetkisiz erişim" }), { status: 401 }));
  const err = await client.categories().catch((e) => e);
  expect(err).toBeInstanceOf(N11Error);
  expect(err.status).toBe(401);
  expect(err.message).toContain("Yetkisiz");
  expect(err.message).not.toContain("gizli-456");
});

test("kategori ağacından yalnız yapraklar yol adıyla", async () => {
  const { client } = fake(() =>
    Response.json({
      categories: [
        {
          id: 1,
          name: "Ayakkabı & Çanta",
          subCategories: [
            { id: 2, name: "Kadın Ayakkabı", subCategories: [{ id: 3, name: "Kadın Bot", subCategories: null }] },
            { id: 4, name: "Erkek Bot", subCategories: [] },
          ],
        },
      ],
    }),
  );
  expect(await client.categories()).toEqual([
    { id: 3, path: "Ayakkabı & Çanta > Kadın Ayakkabı > Kadın Bot" },
    { id: 4, path: "Ayakkabı & Çanta > Erkek Bot" },
  ]);
});

test("kategori özellikleri sadeleştirilir", async () => {
  const { client } = fake(() =>
    Response.json({
      id: 3,
      categoryAttributes: [
        { attributeId: 847, attributeName: "Numara", isMandatory: true, isVariant: true, isSlicer: false, isCustomValue: false, attributeValues: [{ id: 9, value: "38" }] },
        { attributeId: 429, attributeName: "Renk", isMandatory: true, isVariant: false, isSlicer: true, isCustomValue: true, attributeValues: [] },
        { bozuk: true },
      ],
    }),
  );
  expect(await client.categoryAttributes(3)).toEqual([
    { id: 847, name: "Numara", mandatory: true, variant: true, slicer: false, custom: false, values: [{ id: 9, value: "38" }] },
    { id: 429, name: "Renk", mandatory: true, variant: false, slicer: true, custom: true, values: [] },
  ]);
});

const sku: N11Sku = {
  title: "Bot Siyah",
  description: "<p>Deri</p>",
  categoryId: 3,
  currencyType: "TL",
  productMainId: "urun-1",
  preparingDay: 2,
  shipmentTemplate: "STANDART",
  stockCode: "SKU-1",
  barcode: null,
  quantity: 4,
  images: [{ url: "https://fabrikadann.com/medya/p/x-1200.jpg", order: 0 }],
  attributes: [{ id: 1, valueId: null, customValue: "Fabrikadann" }],
  salePrice: 133000,
  listPrice: 133000,
  vatRate: 10,
};

test("ürün yükleme: entegratör adı ve fiyat 2 ondalıklı sayı", async () => {
  const { calls, client } = fake(() => Response.json({ id: 77, type: "PRODUCT_CREATE", status: "IN_QUEUE", reasons: ["1 sku işlenmeye alındı."] }));
  const res = await client.createProducts([{ ...sku, salePrice: 129990, listPrice: 129990 }]);
  expect(res).toEqual({ taskId: "77", status: "IN_QUEUE", reasons: ["1 sku işlenmeye alındı."] });
  expect(calls[0]!.url).toBe("https://api.n11.com/ms/product/tasks/product-create");
  const body = String(calls[0]!.init.body);
  expect(body).toContain('"integrator":"fabrikadann"');
  expect(body).toContain('"salePrice":1299.90');
  expect(body).toContain('"listPrice":1299.90');
  expect(body).not.toContain('"salePrice":"');
});

test("fiyat/stok: yalnız stok gönderilirse fiyat alanları yok", async () => {
  const { calls, client } = fake(() => Response.json({ id: 5, status: "IN_QUEUE", reasons: [] }));
  await client.updatePriceStock([{ stockCode: "SKU-1", quantity: 3 }, { stockCode: "SKU-2", quantity: 0, price: 50000 }]);
  const body = JSON.parse(String(calls[0]!.init.body));
  expect(body.payload.skus[0]).toEqual({ stockCode: "SKU-1", quantity: 3 });
  expect(String(calls[0]!.init.body)).toContain('"listPrice":500.00,"salePrice":500.00');
});

test("görev sonucu tüm sayfalar; SUCCESS dışı başarısız", async () => {
  const { client } = fake(async (_u, init) => {
    const page = JSON.parse(String(init.body)).pageable.page;
    const content =
      page === 0
        ? [{ itemCode: "A", status: "SUCCESS", reasons: ["Başarıyla tamamlandı."] }]
        : [{ itemCode: "B", status: "Fail", reasons: ["Kategori hatalı"] }];
    return Response.json({ taskId: 9, status: "PROCESSED", skus: { content, totalPages: 2, last: page === 1 } });
  });
  expect(await client.taskDetails("9")).toEqual({
    status: "PROCESSED",
    skus: [
      { stockCode: "A", ok: true, reasons: ["Başarıyla tamamlandı."] },
      { stockCode: "B", ok: false, reasons: ["Kategori hatalı"] },
    ],
  });
});

test("siparişler: müşteri bilgisi alınmaz; bozuk paket atlanır", async () => {
  const { calls, client } = fake(() =>
    Response.json({
      totalPages: 1,
      content: [
        {
          id: "112999455244259",
          orderNumber: "203872347637",
          shipmentPackageStatus: "Created",
          lastModifiedDate: 1724323386203,
          packageHistories: [{ createdDate: 1724274054460, status: " Created" }],
          customerfullName: "Ayşe Yılmaz",
          shippingAddress: { address: "Moda Cd." },
          lines: [{ quantity: 2, stockCode: "SKU-1", orderLineId: 415490391, orderItemLineItemStatusName: "Created", productName: "Bot" }],
        },
        { orderNumber: "eksik-id" },
      ],
    }),
  );
  const res = await client.shipmentPackages({ start: 1, end: 2, status: "Created", page: 0 });
  expect(res.skipped).toBe(1);
  expect(res.packages).toEqual([
    {
      id: "112999455244259",
      orderNumber: "203872347637",
      status: "Created",
      orderDate: new Date(1724274054460),
      lastModifiedAt: new Date(1724323386203),
      lines: [{ stockCode: "SKU-1", quantity: 2, lineId: "415490391", status: "Created" }],
    },
  ]);
  expect(JSON.stringify(res)).not.toContain("Ayşe");
  const u = new URL(calls[0]!.url);
  expect(u.pathname).toBe("/rest/delivery/v1/shipmentPackages");
  expect(Object.fromEntries(u.searchParams)).toMatchObject({ startDate: "1", endDate: "2", status: "Created", orderByField: "true", size: "100", page: "0" });
});

test("satır onayı: Picking", async () => {
  const { calls, client } = fake(() => Response.json({ content: [{ lineId: 1, status: "SUCCESS", reasons: "ok" }, { lineId: 2, status: "FAIL", reasons: "olmaz" }] }));
  expect(await client.approveLines(["1", "2"])).toEqual([
    { lineId: "1", ok: true, reason: "ok" },
    { lineId: "2", ok: false, reason: "olmaz" },
  ]);
  expect(calls[0]!.init.method).toBe("PUT");
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ lines: [{ lineId: 1 }, { lineId: 2 }], status: "Picking" });
});
