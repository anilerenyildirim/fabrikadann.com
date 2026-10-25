import type { Metadata } from "next";
import {
  Empty,
  FilterLinks,
  formatDateTime,
  PageHeader,
  Pager,
  pageParam,
  param,
  qs,
  table,
  TableWrap,
  td,
  th,
} from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { auditLabel, listAuditEntries } from "@/server/services/admin/audit-log";
import { PRODUCT_STATUS_LABELS } from "@/server/services/admin/catalog";
import { ORDER_STATUS_LABELS } from "@/server/services/admin/orders";

export const metadata: Metadata = { title: "İşlem günlüğü" };

const GROUPS = [
  { value: "", label: "Hepsi" },
  { value: "order", label: "Siparişler" },
  { value: "payment", label: "Ödemeler" },
  { value: "product", label: "Ürünler" },
  { value: "stock", label: "Stok" },
  { value: "category", label: "Kategoriler" },
  { value: "settings", label: "Ayarlar" },
  { value: "admin", label: "Girişler" },
];

/** Günlük verisindeki kısa ayrıntı (ör. "Hazırlanıyor → Kargoda"); yalnızca düz metin olarak gösterilir. */
function summary(action: string, data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "");
  // Durum kodları Türkçe adlarıyla (bilinmeyen kod olduğu gibi)
  const label = (map: Record<string, string>, v: unknown) => {
    const code = s(v);
    return Object.hasOwn(map, code) ? map[code]! : code;
  };
  if (action === "order.status") {
    return [
      `${label(ORDER_STATUS_LABELS, d.from)} → ${label(ORDER_STATUS_LABELS, d.to)}`,
      d.carrier ? `${s(d.carrier)} ${s(d.trackingNumber)}` : "",
      d.restock === false ? "stoğa eklenmedi" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (action === "stock.adjust") return `${s(d.from)} → ${s(d.to)}${d.note ? ` · ${s(d.note)}` : ""}`;
  if (action === "product.status") return `${label(PRODUCT_STATUS_LABELS, d.from)} → ${label(PRODUCT_STATUS_LABELS, d.to)}`;
  if (Array.isArray(d.changed)) return `Değişen: ${d.changed.map(s).join(", ")}`;
  if (d.name) return s(d.name);
  if (Array.isArray(d.sizes)) return `Numaralar: ${d.sizes.map(s).join(", ")}`;
  return "";
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const group = GROUPS.find((g) => g.value === param(sp.tur, 20))?.value ?? "";
  const page = pageParam(sp.sayfa);
  const result = await listAuditEntries({ page, group: group || undefined });

  return (
    <>
      <PageHeader title="İşlem günlüğü" description="Yönetim işlemleri, girişler ve ödeme uyarıları. Kayıtlar silinemez." />
      <FilterLinks
        label="İşlem türü"
        current={group}
        items={GROUPS.map((g) => ({ value: g.value, label: g.label, href: qs("/yonetim/gunluk", { tur: g.value || undefined }) }))}
      />
      {result.items.length === 0 ? (
        <Empty>Kayıt yok.</Empty>
      ) : (
        <TableWrap label="İşlem günlüğü">
          <table className={`${table} min-w-[860px]`}>
            <thead>
              <tr>
                <th className={th}>Tarih</th>
                <th className={th}>Kişi</th>
                <th className={th}>İşlem</th>
                <th className={th}>Hedef</th>
                <th className={th}>Ayrıntı</th>
                <th className={th}>IP</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((e) => (
                <tr key={e.id}>
                  <td className={`${td} whitespace-nowrap text-graphite`}>{formatDateTime(e.createdAt)}</td>
                  <td className={`${td} max-w-48 truncate`}>{e.actorEmail ?? <span className="text-graphite">Sistem</span>}</td>
                  <td className={td}>
                    <span className="block">{auditLabel(e.action)}</span>
                    <span className="block text-[0.6875rem] text-graphite">{e.action}</span>
                  </td>
                  <td className={`${td} tabular max-w-48 truncate text-[0.75rem]`} title={e.target ?? undefined}>
                    {e.target ?? "—"}
                  </td>
                  <td className={`${td} max-w-72 break-words text-graphite`}>{summary(e.action, e.data) || "—"}</td>
                  <td className={`${td} tabular whitespace-nowrap text-graphite`}>{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Pager
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        unit="kayıt"
        hrefFor={(p) => qs("/yonetim/gunluk", { tur: group || undefined, sayfa: p > 1 ? p : undefined })}
      />
    </>
  );
}
