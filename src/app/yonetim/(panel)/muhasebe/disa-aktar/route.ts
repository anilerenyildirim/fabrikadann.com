import { csvMoney, toCsv } from "@/lib/csv";
import { requireAdmin } from "@/server/auth/current";
import { ledgerForExport, monthRange, purchaseLinesForExport } from "@/server/services/admin/accounting";
import { CATEGORY_LABELS, PAYMENT_METHODS } from "@/server/services/admin/ledger";
import { PURCHASE_KIND_LABELS, purchaseRef } from "@/server/services/admin/purchases";

const METHOD_LABELS: Record<string, string> = PAYMENT_METHODS;

/** Muhasebeci için aylık CSV: ?ay=YYYY-MM&tur=gelir-gider|fisler */
export async function GET(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const { month, from, to } = monthRange(url.searchParams.get("ay")?.slice(0, 7));
  const type = url.searchParams.get("tur") === "fisler" ? "fisler" : "gelir-gider";

  let body: string;
  if (type === "fisler") {
    const rows = await purchaseLinesForExport(from, to);
    body = toCsv(
      ["Tarih", "Fiş", "Tür", "Üretici", "Ürün", "Renk", "Numara", "Üretim barkodu", "Adet", "Birim maliyet", "Tutar"],
      rows.map((r) => {
        const sign = r.kind === "return" ? -1 : 1;
        return [
          r.date,
          purchaseRef(r.number, r.kind),
          PURCHASE_KIND_LABELS[r.kind],
          r.manufacturer,
          r.product_name,
          r.color_name,
          r.size,
          r.production_barcode,
          sign * r.quantity,
          csvMoney(r.unit_cost),
          csvMoney(sign * r.quantity * r.unit_cost),
        ];
      }),
    );
  } else {
    const rows = await ledgerForExport(from, to);
    body = toCsv(
      ["Tarih", "Tür", "Kategori", "Üretici", "Açıklama", "Ödeme şekli", "Tutar"],
      rows.map((r) => [
        r.date,
        r.kind === "income" ? "Gelir" : "Gider",
        CATEGORY_LABELS[r.category] ?? r.category,
        r.manufacturer ?? "",
        r.description,
        METHOD_LABELS[r.method] ?? r.method,
        csvMoney(r.kind === "income" ? r.amount : -r.amount),
      ]),
    );
  }

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fabrikadann-${type}-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
