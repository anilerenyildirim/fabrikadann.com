"use client";

import { useActionState, useState } from "react";
import { Button, Checkbox, SelectField, TextArea, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { slugify } from "@/lib/slug";
import { LooseFieldErrors, StateNotice, useFocusFirstError, useSubmitWithoutReset, type FormAction } from "../forms";

export type ProductInfoValues = {
  productId?: string;
  name: string;
  slug: string;
  description: string;
  details: string;
  categoryId: string;
  price: string;
  trendyolPrice: string;
  status: "draft" | "active" | "archived";
  featured: boolean;
};

const FIELDS = ["name", "slug", "description", "details", "categoryId", "price", "trendyolPrice", "status", "featured"];

export function ProductInfoForm({
  action,
  initial,
  categories,
  mode,
  publishProblem,
}: {
  action: FormAction;
  initial: ProductInfoValues;
  categories: { id: string; name: string }[];
  mode: "create" | "edit";
  publishProblem?: string | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const ref = useFocusFirstError(state);
  const e = state.fieldErrors ?? {};
  const v = (k: keyof ProductInfoValues) => state.values?.[k] ?? String(initial[k] ?? "");
  // Adres alanı boşken addan önizleme göster
  const [namePreview, setNamePreview] = useState(initial.name);
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  // Form sıfırlanmaz: hata sonrası seçim kutuları kullanıcının seçiminde kalır
  const submit = useSubmitWithoutReset(formAction);

  return (
    <form ref={ref} action={formAction} onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-7">
      <StateNotice state={state} />
      <LooseFieldErrors state={state} known={FIELDS} />
      {initial.productId && <input type="hidden" name="productId" value={initial.productId} />}

      <TextField
        label="Ürün adı"
        name="name"
        required
        maxLength={120}
        defaultValue={v("name")}
        error={e.name}
        onChange={(ev) => setNamePreview(ev.currentTarget.value)}
      />
      <TextField
        // Kayıttan sonra sunucunun ürettiği/sadeleştirdiği adres görünsün
        key={`adres-${initial.slug}`}
        label="Adres (slug)"
        name="slug"
        maxLength={80}
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={v("slug")}
        error={e.slug}
        onChange={() => setSlugTouched(true)}
        placeholder={slugify(namePreview) || "addan-uretilir"}
        hint={
          mode === "create" || !slugTouched
            ? "Boş bırakırsanız addan üretilir; aynı adres varsa sonuna -2, -3 eklenir."
            : "Ürünün vitrindeki adresi: /urun/<adres>. Değiştirirseniz eski bağlantılar çalışmaz."
        }
      />

      <div className="grid gap-7 sm:grid-cols-2">
        <TextField
          label="Fiyat (TL, KDV dahil)"
          name="price"
          inputMode="decimal"
          required
          placeholder="1.299,90"
          defaultValue={v("price")}
          error={e.price}
          className="[&_input]:[font-variant-numeric:tabular-nums]"
        />
        <TextField
          label="Trendyol fiyatı (isteğe bağlı)"
          name="trendyolPrice"
          inputMode="decimal"
          placeholder="1.499,90"
          defaultValue={v("trendyolPrice")}
          error={e.trendyolPrice}
          hint="Girilirse ürün sayfasında iki kanalın fiyatı bilgi olarak gösterilir."
          className="[&_input]:[font-variant-numeric:tabular-nums]"
        />
      </div>

      <div className="grid gap-7 sm:grid-cols-2">
        {/*
          React, <select> için defaultValue değişikliğini ekrana yansıtmaz. Durum sayfanın üstündeki
          düğmelerle (Yayına al, Arşivle…) değişince kutu eski durumda kalır ve "Bilgileri kaydet"
          durumu sessizce geri alırdı. key, sunucudaki değer değişince kutuyu yeniden kurar.
        */}
        <SelectField
          key={`kategori-${initial.categoryId}`}
          label="Kategori"
          name="categoryId"
          defaultValue={v("categoryId")}
          error={e.categoryId}
        >
          <option value="">Kategorisiz</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        {mode === "edit" ? (
          <div key={`durum-${initial.status}`} className="flex flex-col">
            {/* Ekranda görülen durum: kutuya dokunulmadıysa sunucu başka sekmedeki değişikliği geri almaz */}
            <input type="hidden" name="statusShown" value={initial.status} />
            <SelectField label="Durum" name="status" defaultValue={v("status")} error={e.status}>
              <option value="draft">Taslak — vitrinde görünmez</option>
              <option value="active">Yayında — vitrinde satılır</option>
              <option value="archived">Arşivde — satıştan kalktı</option>
            </SelectField>
          </div>
        ) : (
          <div className="flex flex-col">
            <span className="label text-graphite">Durum</span>
            <p className="min-h-11 border-b border-rule py-2 text-graphite">Taslak</p>
            <p className="mt-1.5 text-[0.8125rem] text-graphite">Görsel ve numara ekledikten sonra yayına alırsınız.</p>
          </div>
        )}
      </div>
      {mode === "edit" && publishProblem && v("status") !== "active" && (
        <p className="-mt-4 text-[0.8125rem] text-graphite">{publishProblem}</p>
      )}

      <TextArea
        label="Açıklama"
        name="description"
        rows={5}
        maxLength={5000}
        defaultValue={v("description")}
        error={e.description}
      />
      <TextArea
        label="Malzeme ve bakım"
        name="details"
        rows={4}
        maxLength={5000}
        defaultValue={v("details")}
        error={e.details}
        placeholder={"Saya: hakiki deri\nTaban: kauçuk\nNemli bezle silin."}
      />
      <Checkbox
        label="Öne çıkan ürün (ana sayfada gösterilir)"
        name="featured"
        defaultChecked={state.values ? state.values.featured === "on" : initial.featured}
      />

      <div>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Kaydediliyor…" : mode === "create" ? "Ürünü oluştur" : "Bilgileri kaydet"}
        </Button>
      </div>
    </form>
  );
}
