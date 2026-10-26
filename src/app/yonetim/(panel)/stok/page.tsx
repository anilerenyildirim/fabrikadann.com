import type { Metadata } from "next";
import Link from "next/link";
import { StockAdjustForm } from "@/components/admin/product/ProductForms";
import { TrendyolPanel } from "@/components/admin/TrendyolPanel";
import {
  Empty,
  FilterLinks,
  formatDateTime,
  PageHeader,
  Pager,
  pageParam,
  param,
  qs,
  SearchForm,
  Section,
  table,
  TableWrap,
  td,
  th,
} from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { listStockMovements, listStockRows, STOCK_REASON_LABELS, type StockFilter } from "@/server/services/admin/stock";
import { getTrendyolStatus } from "@/server/services/trendyol";
import { adjustStockAction } from "./actions";

export const metadata: Metadata = { title: "Stok" };

const STOCK_PAGE_SIZE = 50;

const FILTERS: { value: StockFilter; label: string }[] = [
  { value: "all", label: "Hepsi" },
  { value: "low", label: "Az kalan (1–2)" },
  { value: "out", label: "Tükenen" },
];

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = param(sp.q);
  const f = param(sp.filtre);
  const filter: StockFilter = f === "low" || f === "out" ? f : "all";
  const [all, movements, trendyol] = await Promise.all([listStockRows({ filter, q }), listStockMovements(50), getTrendyolStatus()]);
  // Her satırda bir form var; sayfa telefonda hafif kalsın diye 50'şer satır
  const pageCount = Math.max(1, Math.ceil(all.length / STOCK_PAGE_SIZE));
  const page = Math.min(pageParam(sp.sayfa), pageCount);
  const rows = all.slice((page - 1) * STOCK_PAGE_SIZE, page * STOCK_PAGE_SIZE);
  const href = (p: number) => qs("/yonetim/stok", { q, filtre: filter === "all" ? undefined : filter, sayfa: p > 1 ? p : undefined });

  return (
    <>
      <PageHeader
        title="Stok"
        description={<>Satılabilir stok, ödeme bekleyen ve hazırlanan siparişler düşüldükten sonra kalan adettir; depoda sayım yaptıysanız “Depo sayımı” seçin, ayrılmış adetler otomatik düşülür. Stok Trendyol ile ortak: Trendyol siparişleri buradan düşülür, Trendyol'da kargolanmamış olanlar da ayrılmış sayılır. Her değişiklik sebebiyle birlikte stok hareketlerine yazılır.</>}
      />
      <SearchForm action="/yonetim/stok" q={q} placeholder="Ürün adı, SKU ya da barkod" hidden={{ filtre: filter === "all" ? undefined : filter }} />
      <FilterLinks
        label="Stok süzgeci"
        current={filter}
        items={FILTERS.map((x) => ({
          value: x.value,
          label: x.label,
          href: qs("/yonetim/stok", { q, filtre: x.value === "all" ? undefined : x.value }),
        }))}
      />

      {rows.length === 0 ? (
        <Empty>{q || filter !== "all" ? "Bu süzgece uyan numara yok." : "Henüz numara yok. Ürün sayfasından numara ekleyin."}</Empty>
      ) : (
        <TableWrap label="Stok listesi">
          <table className={`${table} min-w-[980px]`}>
            <thead>
              <tr>
                <th className={th}>Ürün</th>
                <th className={th}>Renk</th>
                <th className={th}>Numara</th>
                <th className={th}>SKU</th>
                <th className={`${th} text-right`}>Satılabilir</th>
                <th className={`${th} text-right`}>
                  <abbr title="Kargolanmamış siparişlerde ayrılmış (stoktan düşülmüş) adet" className="no-underline">
                    Ayrılmış
                  </abbr>
                </th>
                <th className={th}>Düzelt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.variantId}>
                  <td className={`${td} max-w-56`}>
                    <Link href={`/yonetim/urunler/${r.productId}#numaralar`} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                      <span className="truncate">{r.productName}</span>
                    </Link>
                    {r.productStatus !== "active" && (
                      <span className="block text-[0.75rem] text-graphite">{r.productStatus === "draft" ? "Taslak" : "Arşivde"}</span>
                    )}
                  </td>
                  <td className={`${td} text-graphite`}>{r.colorName}</td>
                  <td className={`${td} tabular`}>{r.size}</td>
                  <td className={`${td} tabular text-[0.75rem]`}>{r.sku}</td>
                  <td className={`${td} tabular text-right`}>
                    {r.stock === 0 ? <span className="label bg-ink px-2 py-0.5 text-paper">0</span> : r.stock}
                  </td>
                  <td className={`${td} tabular text-right text-graphite`}>{r.reserved || "—"}</td>
                  <td className={td}>
                    <StockAdjustForm action={adjustStockAction} variantId={r.variantId} stock={r.stock} reserved={r.reserved} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {all.length > 0 && <Pager page={page} pageCount={pageCount} total={all.length} unit="numara" hrefFor={href} />}

      <div className="mt-12">
        <TrendyolPanel status={trendyol} />
      </div>

      <div>
        <Section title="Son stok hareketleri" description="Sipariş, iptal/iade, Trendyol ve elle düzeltmeler; en yenisi üstte.">
          {movements.length === 0 ? (
            <Empty>Henüz stok hareketi yok.</Empty>
          ) : (
            <TableWrap label="Stok hareketleri">
              <table className={`${table} min-w-[820px]`}>
                <thead>
                  <tr>
                    <th className={th}>Tarih</th>
                    <th className={th}>Ürün</th>
                    <th className={`${th} text-right`}>Fark</th>
                    <th className={th}>Sebep</th>
                    <th className={th}>Not / referans</th>
                    <th className={th}>Kişi</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className={`${td} whitespace-nowrap text-graphite`}>{formatDateTime(m.createdAt)}</td>
                      <td className={`${td} max-w-64`}>
                        <span className="block truncate">{m.productName}</span>
                        <span className="block text-[0.75rem] text-graphite">
                          {m.colorName} · {m.size} · <span className="tabular">{m.sku}</span>
                        </span>
                      </td>
                      <td className={`${td} tabular text-right`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                      <td className={td}>{STOCK_REASON_LABELS[m.reason]}</td>
                      <td className={`${td} max-w-64 break-words text-graphite`}>{[m.note, m.reference].filter(Boolean).join(" · ") || "—"}</td>
                      <td className={`${td} max-w-48 truncate text-graphite`}>{m.actorEmail ?? (m.reason === "order" ? "Müşteri" : m.reason === "trendyol" ? "Trendyol" : "Sistem")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Section>
      </div>
    </>
  );
}
