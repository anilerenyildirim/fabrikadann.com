import type { Metadata } from "next";
import Link from "next/link";
import { CategoryForm } from "@/components/admin/CategoryForms";
import { ActionButton, MoveButtons } from "@/components/admin/forms";
import { Empty, PageHeader, Section, qs } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { listAdminCategories } from "@/server/services/admin/catalog";
import { createCategoryAction, deleteCategoryAction, moveCategoryAction, updateCategoryAction } from "./actions";

export const metadata: Metadata = { title: "Kategoriler" };

export default async function CategoriesPage() {
  await requireAdmin();
  const categories = await listAdminCategories();
  return (
    <>
      <PageHeader
        title="Kategoriler"
        description="Vitrindeki menü bu sırayla görünür. Kategori silinince ürünleri silinmez, kategorisiz kalır."
      />
      <Section title="Kategori ekle">
        <CategoryForm action={createCategoryAction} />
      </Section>
      <Section title={`Kategoriler (${categories.length})`}>
        {categories.length === 0 ? (
          <Empty>Henüz kategori yok.</Empty>
        ) : (
          <ol className="border-t border-ink">
            {categories.map((c, i) => (
              <li key={c.id} className="flex flex-col gap-4 border-b border-rule py-5 lg:flex-row lg:items-start">
                <div className="flex items-start gap-3 lg:pt-4">
                  <span className="label tabular mt-3.5 w-6 text-graphite" aria-hidden="true">
                    {i + 1}.
                  </span>
                  <MoveButtons
                    action={moveCategoryAction}
                    fields={{ categoryId: c.id }}
                    isFirst={i === 0}
                    isLast={i === categories.length - 1}
                    what={`${c.name} kategorisi`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <CategoryForm action={updateCategoryAction} category={c} />
                </div>
                <div className="flex flex-wrap items-center gap-4 lg:w-56 lg:flex-col lg:items-end lg:pt-4">
                  <Link
                    href={qs("/yonetim/urunler", { kategori: c.id })}
                    className="label inline-flex min-h-11 items-center text-graphite"
                  >
                    {c.productCount} ürün
                  </Link>
                  <ActionButton
                    action={deleteCategoryAction}
                    fields={{ categoryId: c.id }}
                    label="Sil"
                    ariaLabel={`${c.name} kategorisini sil`}
                    pendingLabel="Siliniyor…"
                    variant="quiet"
                    confirm={
                      c.productCount > 0
                        ? `"${c.name}" silinsin mi? İçindeki ${c.productCount} ürün kategorisiz kalacak (ürünler silinmez).`
                        : `"${c.name}" silinsin mi?`
                    }
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}
