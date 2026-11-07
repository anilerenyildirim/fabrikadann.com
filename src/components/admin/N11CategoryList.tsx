"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/form";
import { ActionButton, type FormAction } from "./forms";
import { N11CategoryMapForm, type N11MapActions } from "./N11CategoryMapForm";
import { ErrorMark } from "@/components/ui/form";

export type CategoryMapRow = {
  id: string;
  name: string;
  externalCategoryId: number | null;
  externalPath: string | null;
  attributes: { id: number; name: string; valueId: number | null; customValue: string | null }[] | null;
};

export function N11CategoryList({ rows, actions, remove, disabled }: { rows: CategoryMapRow[]; actions: N11MapActions; remove: FormAction; disabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="border-t border-ink">
      {rows.map((r) => (
        <li key={r.id} className={`border-b border-rule px-3 py-3 ${r.externalCategoryId ? "" : "bg-caution/5"}`}>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1 py-2 text-[0.8125rem]">
              <p className="flex items-start gap-1.5 font-medium">
                {!r.externalCategoryId && <ErrorMark />}
                {r.name}
              </p>
              <p className="mt-1 text-graphite [overflow-wrap:anywhere]">
                {r.externalPath ? `N11: ${r.externalPath}` : "N11 kategorisi seçilmedi"}
                {r.attributes?.length ? ` · ${r.attributes.map((a) => `${a.name}: ${a.customValue ?? "seçildi"}`).join(", ")}` : ""}
              </p>
            </div>
            {open !== r.id && (
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="secondary" disabled={disabled} onClick={() => setOpen(r.id)} className="min-h-11 px-4">
                  {r.externalCategoryId ? "Değiştir" : "Eşleştir"}
                </Button>
                {r.externalCategoryId && <ActionButton action={remove} fields={{ categoryId: r.id }} label="Kaldır" variant="quiet" />}
              </div>
            )}
          </div>
          {open === r.id && (
            <div className="mt-3">
              <N11CategoryMapForm
                categoryId={r.id}
                current={r.externalCategoryId ? { externalId: r.externalCategoryId, path: r.externalPath ?? "", attributes: r.attributes ?? [] } : null}
                actions={actions}
                onDone={() => {
                  setOpen(null);
                  router.refresh();
                }}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
