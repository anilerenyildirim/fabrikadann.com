"use client";

import { useActionState, useId } from "react";
import { Button, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { slugify } from "@/lib/slug";
import { InlineError, InlineOk, type FormAction } from "./forms";

/** Kategori ekleme ya da düzenleme (ad + adres). */
export function CategoryForm({
  action,
  category,
}: {
  action: FormAction;
  category?: { id: string; name: string; slug: string };
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  // Sayfada her kategori için bir form var: alan kimlikleri tekil olmalı (etiket doğru alana bağlansın)
  const id = useId();
  const e = state.fieldErrors ?? {};
  const isNew = !category;
  const reset = isNew && state.ok;
  return (
    <form action={formAction} className="flex min-w-0 flex-col gap-2">
      {category && <input type="hidden" name="categoryId" value={category.id} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <TextField
          id={`${id}-ad`}
          label={isNew ? "Yeni kategori" : "Ad"}
          name="name"
          required
          maxLength={60}
          placeholder={isNew ? "ör. Kadın" : undefined}
          defaultValue={reset ? "" : (state.values?.name ?? category?.name)}
          error={e.name}
          className="sm:flex-1"
        />
        <TextField
          id={`${id}-adres`}
          label="Adres"
          name="slug"
          maxLength={60}
          autoCapitalize="none"
          spellCheck={false}
          placeholder={isNew ? "addan üretilir" : undefined}
          defaultValue={reset ? "" : (state.values?.slug ?? category?.slug)}
          error={e.slug}
          className="sm:w-48"
          hint={isNew ? undefined : `/kategori/${slugify(category?.slug ?? "")}`}
        />
        <Button type="submit" variant={isNew ? "primary" : "secondary"} disabled={pending} className="min-h-11 shrink-0">
          {pending ? "Kaydediliyor…" : isNew ? "Kategori ekle" : "Kaydet"}
        </Button>
      </div>
      <InlineError message={state.error ?? e.categoryId} />
      <InlineOk message={state.ok ? state.message : undefined} />
    </form>
  );
}
