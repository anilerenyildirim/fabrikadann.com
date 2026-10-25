"use client";

import { useActionState, useId } from "react";
import { Button, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { firstError, InlineError, InlineOk, useSubmitWithoutReset, useSuccessKey, type FormAction } from "../forms";

// Odakta alt çizgi 2px'e kalınlaşır (yerleşim kaymadan): klavyeyle gezinirken görünür odak
export const inputCls =
  "min-h-11 w-full border-0 border-b bg-transparent px-0 py-2 outline-none placeholder:text-ash focus:border-ink focus:shadow-[0_1px_0_0_var(--color-ink)]";

function SmallField({
  label,
  name,
  error,
  defaultValue,
  className = "",
  ...props
}: React.ComponentProps<"input"> & { label: string; name: string; error?: string }) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <label htmlFor={id} className="label text-graphite">
        {label}
      </label>
      <input
        id={id}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-hata` : undefined}
        className={`${inputCls} ${error ? "border-b-2 border-ink" : "border-ash"}`}
        {...props}
      />
      {error && (
        <span id={`${id}-hata`} className="sr-only">
          {error}
        </span>
      )}
    </div>
  );
}

/** Yeni renk ekleme. */
export function AddColorForm({ action, productId }: { action: FormAction; productId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  // Aynı sayfadaki ürün adı alanıyla kimlik çakışmasın (etiket yanlış alana bağlanırdı)
  const fieldId = useId();
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-2">
      <input type="hidden" name="productId" value={productId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField
          id={fieldId}
          label="Yeni renk"
          name="name"
          maxLength={40}
          placeholder="ör. Siyah"
          defaultValue={state.ok ? "" : state.values?.name}
          error={state.fieldErrors?.name}
          className="flex-1"
        />
        <Button type="submit" variant="secondary" disabled={pending} className="min-h-11 shrink-0">
          {pending ? "Ekleniyor…" : "Renk ekle"}
        </Button>
      </div>
      <InlineError message={state.error ?? state.fieldErrors?.productId} />
      <InlineOk message={state.ok ? state.message : undefined} />
    </form>
  );
}

/** Renk adını satır içinde değiştirme. */
export function RenameColorForm({ action, colorId, name }: { action: FormAction; colorId: string; name: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const error = firstError(state, ["name"]);
  return (
    <form action={formAction} className="flex min-w-0 flex-1 flex-col">
      <input type="hidden" name="colorId" value={colorId} />
      <div className="flex items-end gap-2">
        <SmallField
          label="Renk adı"
          name="name"
          maxLength={40}
          required
          defaultValue={state.values?.name ?? name}
          error={error}
          className="max-w-xs flex-1"
        />
        <Button type="submit" variant="quiet" disabled={pending} className="shrink-0">
          {pending ? "…" : "Adı kaydet"}
        </Button>
      </div>
      <InlineError message={error} />
      <InlineOk message={state.ok ? state.message : undefined} />
    </form>
  );
}

/** Görsel alt metni. */
export function ImageAltForm({ action, imageId, alt }: { action: FormAction; imageId: string; alt: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const error = firstError(state, ["alt"]);
  return (
    <form action={formAction} className="flex flex-col">
      <input type="hidden" name="imageId" value={imageId} />
      <div className="flex items-end gap-2">
        <SmallField
          label="Alt metin"
          name="alt"
          maxLength={200}
          defaultValue={state.values?.alt ?? alt}
          placeholder="Görseli anlatın"
          error={error}
          className="flex-1 text-[0.8125rem]"
        />
        <Button type="submit" variant="quiet" disabled={pending} className="shrink-0">
          {pending ? "…" : "Kaydet"}
        </Button>
      </div>
      <InlineError message={error} />
      <InlineOk message={state.ok ? state.message : undefined} />
    </form>
  );
}

/** Renge numara ekleme: "36-41", "38, 38.5" ve başlangıç stoğu. */
export function AddVariantsForm({ action, colorId, colorName }: { action: FormAction; colorId: string; colorName: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="colorId" value={colorId} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <SmallField
          label={`Numara ekle — ${colorName}`}
          name="sizes"
          placeholder="36-41 ya da 38, 38.5, 39"
          maxLength={300}
          autoComplete="off"
          defaultValue={state.ok ? "" : state.values?.sizes}
          key={state.ok ? state.message : "numara"}
          error={e.sizes}
          className="sm:flex-1"
        />
        <SmallField
          label="Başlangıç stoğu"
          name="stock"
          inputMode="numeric"
          pattern="[0-9]*"
          defaultValue={state.ok ? "0" : (state.values?.stock ?? "0")}
          error={e.stock}
          className="sm:w-32"
        />
        <Button type="submit" variant="secondary" disabled={pending} className="min-h-11 shrink-0">
          {pending ? "Ekleniyor…" : "Numaraları ekle"}
        </Button>
      </div>
      <InlineError message={firstError(state, ["sizes", "stock"])} />
      <InlineOk message={state.ok ? state.message : undefined} />
      {!state.error && !e.sizes && (
        <p className="text-[0.75rem] text-graphite">
          Aralık (36-41) tam numaraları ekler; yarım numaraları ayrıca yazın (38.5). Var olan numaralar atlanır.
        </p>
      )}
    </form>
  );
}

/** Varyantın SKU ve barkodu. */
export function VariantCodesForm({
  action,
  variantId,
  sku,
  barcode,
}: {
  action: FormAction;
  variantId: string;
  sku: string;
  barcode: string | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="flex min-w-0 flex-col">
      <input type="hidden" name="variantId" value={variantId} />
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <SmallField
          label="SKU"
          name="sku"
          required
          maxLength={64}
          autoCapitalize="characters"
          spellCheck={false}
          defaultValue={state.values?.sku ?? sku}
          error={e.sku}
          className="w-44 [&_input]:text-[0.8125rem]"
        />
        <SmallField
          label="Barkod"
          name="barkod"
          maxLength={32}
          inputMode="numeric"
          spellCheck={false}
          defaultValue={state.values?.barkod ?? barcode ?? ""}
          placeholder="—"
          error={e.barcode ?? e.barkod}
          className="w-36 [&_input]:text-[0.8125rem]"
        />
        <Button type="submit" variant="quiet" disabled={pending} className="shrink-0">
          {pending ? "…" : "Kaydet"}
        </Button>
      </div>
      <InlineError message={firstError(state, ["sku", "barcode", "barkod"])} />
      <InlineOk message={state.ok ? state.message : undefined} />
    </form>
  );
}

/**
 * Satır içi stok düzeltmesi: yeni değer + zorunlu sebep. "Satılabilir" doğrudan satılabilir stoğu
 * yazar; "Depo sayımı" bekleyen siparişlerde ayrılmış adetleri düşerek satılabilir stoğu hesaplar.
 */
export function StockAdjustForm({
  action,
  variantId,
  stock,
  reserved = 0,
  compact = false,
}: {
  action: FormAction;
  variantId: string;
  stock: number;
  reserved?: number;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const e = state.fieldErrors ?? {};
  const id = useId();
  // Form sıfırlanmaz: sıfırlansaydı hata sonrası "Depo sayımı" seçimi "Satılabilir"e döner, girilen
  // sayım düzeltilip gönderilince satılabilir stok olarak yazılırdı. Başarıdan ya da stok
  // değişince alanlar yeni değerle yeniden kurulur.
  const submit = useSubmitWithoutReset(formAction);
  const done = useSuccessKey(state);
  return (
    <form action={formAction} onSubmit={submit} className="flex min-w-0 flex-col">
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="expected" value={String(stock)} />
      <div key={`${stock}-${done}`} className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="flex flex-col">
          <label htmlFor={`${id}-tur`} className="label text-graphite">
            Tür
          </label>
          <select
            id={`${id}-tur`}
            name="mode"
            defaultValue={state.ok ? "available" : (state.values?.mode ?? "available")}
            className="min-h-11 rounded-none border-0 border-b border-ash bg-transparent py-2 pr-1 text-[0.8125rem] outline-none focus:border-ink focus:shadow-[0_1px_0_0_var(--color-ink)]"
            title={reserved > 0 ? `Bekleyen siparişlerde ${reserved} adet ayrılmış` : undefined}
          >
            <option value="available">Satılabilir</option>
            <option value="physical">Depo sayımı</option>
          </select>
        </div>
        <SmallField
          label="Yeni değer"
          name="stock"
          inputMode="numeric"
          pattern="[0-9]*"
          required
          maxLength={6}
          defaultValue={state.ok ? String(stock) : (state.values?.stock ?? String(stock))}
          error={e.stock}
          className="w-20 [&_input]:[font-variant-numeric:tabular-nums]"
        />
        <SmallField
          label="Sebep"
          name="note"
          maxLength={200}
          required
          placeholder={compact ? "Sayım farkı" : "ör. Sayım farkı, Trendyol satışı"}
          defaultValue={state.ok ? "" : state.values?.note}
          error={e.note}
          className={compact ? "w-40" : "w-56"}
        />
        <Button type="submit" variant="quiet" disabled={pending} className="shrink-0">
          {pending ? "…" : "Stoğu kaydet"}
        </Button>
      </div>
      <InlineError message={firstError(state, ["stock", "note"])} />
      <InlineOk message={state.ok ? state.message : undefined} />
    </form>
  );
}
