import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/form";
import { ProductImage } from "@/components/ui/ProductImage";
import {
  Empty,
  FilterLinks,
  PageHeader,
  param,
  ProductStatusTag,
  qs,
  SearchForm,
  table,
  TableWrap,
  td,
  th,
} from "@/components/admin/ui";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { categoryOptions, listAdminProducts, type ProductStatus } from "@/server/services/admin/catalog";

export const metadata: Metadata = { title: "Ürünler" };

const STATUS_FILTERS: { value: ProductStatus | "all"; label: string }[] = [
  { value: "all", label: "Hepsi" },
  { value: "active", label: "Yayında" },
  { value: "draft", label: "Taslak" },
  { value: "archived", label: "Arşivde" },
];

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = param(sp.q);
  const statusParam = param(sp.durum);
  const status = STATUS_FILTERS.some((f) => f.value === statusParam) ? (statusParam as ProductStatus | "all") : "all";
  const categoryParam = param(sp.kategori, 36);
  const [rows, categories] = await Promise.all([
    listAdminProducts({ q, status, categoryId: categoryParam }),
    categoryOptions(),
  ]);
  const category = categories.find((c) => c.id === categoryParam);
  const kategori = category?.id;

  return (
    <>
      <PageHeader
        title="Ürünler"
        description="Ürün silinmez, arşivlenir; böylece eski siparişlerin kaydı bozulmaz."
        actions={<ButtonLink href="/yonetim/urunler/yeni">Yeni ürün</ButtonLink>}
      />
      <SearchForm
        action="/yonetim/urunler"
        q={q}
        placeholder="Ürün adı ya da SKU"
        hidden={{ durum: status === "all" ? undefined : status, kategori }}
      />
      {category && (
        <p className="mb-4 flex flex-wrap items-center gap-3 text-[0.8125rem]">
          <span>
            Kategori: <strong className="font-medium">{category.name}</strong>
          </span>
          <Link href={qs("/yonetim/urunler", { q, durum: status === "all" ? undefined : status })} className="inline-flex min-h-11 items-center underline underline-offset-4">
            Süzgeci kaldır
          </Link>
        </p>
      )}
      <FilterLinks
        label="Durum"
        current={status}
        items={STATUS_FILTERS.map((f) => ({
          value: f.value,
          label: f.label,
          href: qs("/yonetim/urunler", { q, kategori, durum: f.value === "all" ? undefined : f.value }),
        }))}
      />

      {rows.length === 0 ? (
        <Empty>
          {q || status !== "all" || kategori ? (
            "Bu süzgece uyan ürün yok."
          ) : (
            <>
              Henüz ürün yok.{" "}
              <Link href="/yonetim/urunler/yeni" className="text-ink underline underline-offset-4">
                İlk ürünü ekleyin
              </Link>
              .
            </>
          )}
        </Empty>
      ) : (
        <TableWrap label="Ürün listesi">
          <table className={`${table} min-w-[680px]`}>
            <thead>
              <tr>
                <th className={`${th} w-14`}>
                  <span className="sr-only">Görsel</span>
                </th>
                <th className={th}>Ürün</th>
                <th className={th}>Kategori</th>
                <th className={`${th} text-right`}>Fiyat</th>
                <th className={th}>Durum</th>
                <th className={`${th} text-right`}>Stok</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-fog">
                  <td className={`${td} py-2`}>
                    <Link href={`/yonetim/urunler/${p.id}`} tabIndex={-1} aria-hidden="true" className="block w-10">
                      <ProductImage image={p.image} sizes="40px" className="w-10" />
                    </Link>
                  </td>
                  <td className={td}>
                    <Link href={`/yonetim/urunler/${p.id}`} className="inline-flex min-h-11 flex-col justify-center underline-offset-4 hover:underline">
                      <span>{p.name}</span>
                      <span className="text-[0.75rem] text-graphite">
                        {p.colorCount} renk · {p.variantCount} numara{p.featured ? " · öne çıkan" : ""}
                      </span>
                    </Link>
                  </td>
                  <td className={`${td} text-graphite`}>{p.categoryName ?? "—"}</td>
                  <td className={`${td} tabular text-right whitespace-nowrap`}>{formatPrice(p.price)}</td>
                  <td className={td}>
                    <ProductStatusTag status={p.status} />
                  </td>
                  <td className={`${td} tabular text-right`}>
                    {p.variantCount === 0 ? <span className="text-ash">—</span> : p.totalStock === 0 ? <span className="label">Tükendi</span> : p.totalStock}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {rows.length > 0 && <p className="label mt-4 text-graphite">{rows.length} ürün</p>}
    </>
  );
}
