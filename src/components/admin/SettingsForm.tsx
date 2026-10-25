"use client";

import { useActionState } from "react";
import { Button, TextArea, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { LooseFieldErrors, StateNotice, useFocusFirstError, type FormAction } from "./forms";

export type SettingsValues = Record<
  | "shippingFee"
  | "freeShippingThreshold"
  | "companyName"
  | "companyAddress"
  | "taxOffice"
  | "taxNumber"
  | "mersisNumber"
  | "email"
  | "phone"
  | "kepAddress"
  | "instagramUrl"
  | "trendyolUrl"
  | "announcement",
  string
>;

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-rule pt-6">
      <legend className="label float-left mb-1 w-full">{title}</legend>
      {description && <p className="clear-left mb-5 text-[0.8125rem] text-graphite">{description}</p>}
      <div className="clear-left grid gap-7 pt-2 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function SettingsForm({ action, initial }: { action: FormAction; initial: SettingsValues }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const ref = useFocusFirstError(state);
  const e = state.fieldErrors ?? {};
  const v = (k: keyof SettingsValues) => state.values?.[k] ?? initial[k];
  return (
    <form ref={ref} action={formAction} noValidate className="flex max-w-3xl flex-col gap-10">
      <StateNotice state={state} />
      <LooseFieldErrors state={state} known={Object.keys(initial)} />

      <Group title="Kargo" description="Tutarlar KDV dahil TL. Sepet ara toplamı eşiğe ulaşınca kargo ücretsiz olur; eşik 0 ise kargo hep ücretlidir.">
        <TextField
          label="Kargo ücreti (TL)"
          name="shippingFee"
          inputMode="decimal"
          placeholder="99,90"
          defaultValue={v("shippingFee")}
          error={e.shippingFee}
        />
        <TextField
          label="Ücretsiz kargo eşiği (TL)"
          name="freeShippingThreshold"
          inputMode="decimal"
          placeholder="1.500,00"
          defaultValue={v("freeShippingThreshold")}
          error={e.freeShippingThreshold}
        />
      </Group>

      <Group title="Duyuru şeridi" description="Sitenin en üstündeki siyah şerit. Boş bırakırsanız gösterilmez.">
        <TextField
          label="Duyuru metni"
          name="announcement"
          maxLength={200}
          placeholder="ör. 1.500 TL üzeri kargo ücretsiz"
          defaultValue={v("announcement")}
          error={e.announcement}
          className="sm:col-span-2"
        />
      </Group>

      <Group
        title="Şirket bilgileri"
        description="Yasal sayfalarda (mesafeli satış sözleşmesi, ön bilgilendirme, KVKK) ve site altında gösterilir."
      >
        <TextField label="Ticari unvan" name="companyName" maxLength={200} defaultValue={v("companyName")} error={e.companyName} className="sm:col-span-2" />
        <TextArea
          label="Adres"
          name="companyAddress"
          rows={3}
          maxLength={500}
          defaultValue={v("companyAddress")}
          error={e.companyAddress}
          className="sm:col-span-2"
        />
        <TextField label="Vergi dairesi" name="taxOffice" maxLength={100} defaultValue={v("taxOffice")} error={e.taxOffice} />
        <TextField
          label="Vergi / TC kimlik no"
          name="taxNumber"
          inputMode="numeric"
          maxLength={11}
          defaultValue={v("taxNumber")}
          error={e.taxNumber}
        />
        <TextField
          label="MERSİS no"
          name="mersisNumber"
          inputMode="numeric"
          maxLength={16}
          defaultValue={v("mersisNumber")}
          error={e.mersisNumber}
        />
        <TextField label="KEP adresi" name="kepAddress" maxLength={200} defaultValue={v("kepAddress")} error={e.kepAddress} />
        <TextField
          label="Destek e-postası"
          name="email"
          type="email"
          inputMode="email"
          maxLength={200}
          defaultValue={v("email")}
          error={e.email}
        />
        <TextField label="Telefon" name="phone" type="tel" maxLength={30} defaultValue={v("phone")} error={e.phone} />
      </Group>

      <Group title="Bağlantılar" description="Yalnızca https:// ile başlayan adresler. Boş bırakılan bağlantı site altında gösterilmez.">
        <TextField
          label="Instagram"
          name="instagramUrl"
          type="url"
          inputMode="url"
          maxLength={300}
          placeholder="https://instagram.com/fabrikadann"
          defaultValue={v("instagramUrl")}
          error={e.instagramUrl}
        />
        <TextField
          label="Trendyol mağazası"
          name="trendyolUrl"
          type="url"
          inputMode="url"
          maxLength={300}
          placeholder="https://www.trendyol.com/magaza/…"
          defaultValue={v("trendyolUrl")}
          error={e.trendyolUrl}
        />
      </Group>

      <div>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Kaydediliyor…" : "Ayarları kaydet"}
        </Button>
      </div>
    </form>
  );
}
