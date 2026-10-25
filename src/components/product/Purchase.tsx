"use client";

import Link from "next/link";
import { createContext, startTransition, use, useActionState, useRef, useState, type ReactNode } from "react";
import { addToCartAction } from "@/app/(magaza)/actions/cart";
import { Button, ErrorMark } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import type { Availability } from "@/server/services/catalog";

export type SizeOption = { id: string; size: string; availability: Availability };

const FORM_ID = "sepete-ekle";
const CHOOSE_SIZE = "Önce numaranızı seçin.";

type Feedback = { kind: "success" } | { kind: "error"; text: string } | null;

type PurchaseState = {
  sizes: SizeOption[];
  selected: SizeOption | null;
  select: (id: string) => void;
  soldOut: boolean;
  pending: boolean;
  feedback: Feedback;
  formAction: (formData: FormData) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  fieldsetRef: React.RefObject<HTMLFieldSetElement | null>;
};

const PurchaseContext = createContext<PurchaseState | null>(null);

function usePurchase(): PurchaseState {
  const ctx = use(PurchaseContext);
  if (!ctx) throw new Error("PurchaseProvider eksik");
  return ctx;
}

/**
 * Ürün sayfasında numara seçimi ile "Sepete ekle" düğmelerinin (masaüstü panel + mobil alt çubuk)
 * ortak durumu. Renk değişince `key` ile sıfırlanır.
 */
export function PurchaseProvider({ sizes, children }: { sizes: SizeOption[]; children: ReactNode }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addToCartAction, {});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // Seçim değişince önceki sonucun mesajı gizlenir
  const [dismissed, setDismissed] = useState<FormState | null>(null);
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);

  const selected = sizes.find((s) => s.id === selectedId) ?? null;
  const soldOut = sizes.every((s) => s.availability === "out");

  const serverFeedback: Feedback =
    state === dismissed || (!state.ok && !state.error)
      ? null
      : state.ok
        ? { kind: "success" }
        : { kind: "error", text: state.error ?? CHOOSE_SIZE };
  const feedback: Feedback = localError ? { kind: "error", text: localError } : serverFeedback;

  const value: PurchaseState = {
    sizes,
    selected,
    soldOut,
    pending,
    feedback,
    formAction,
    fieldsetRef,
    select: (id) => {
      setSelectedId(id);
      setLocalError(null);
      setDismissed(state);
    },
    onSubmit: (e) => {
      /*
        JavaScript varken gönderimi burada başlatıyoruz: form action'a bırakılırsa React eylemden
        sonra formu sıfırlar, seçili numaranın işareti kalkar (durum ise seçili kalır). JavaScript
        yoksa form action'ı (Server Action) doğrudan çalışır.
        Seçim DOM'dan okunur: sayfa hidrasyondan önce tıklanmış olabilir.
      */
      e.preventDefault();
      if (pending) return;
      const formData = new FormData(e.currentTarget);
      const variantId = formData.get("variantId");
      const chosen = typeof variantId === "string" ? sizes.find((s) => s.id === variantId && s.availability !== "out") : undefined;
      if (chosen) {
        if (chosen.id !== selectedId) setSelectedId(chosen.id);
        setLocalError(null);
        startTransition(() => formAction(formData));
        return;
      }
      setLocalError(CHOOSE_SIZE);
      const fieldset = fieldsetRef.current;
      const firstAvailable = fieldset?.querySelector<HTMLInputElement>("input:not(:disabled)");
      // Mobilde numaralar alt çubuğun altında kalmasın: ekranın ortasına getir
      if (fieldset && !window.matchMedia("(min-width: 768px)").matches) {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        fieldset.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
        firstAvailable?.focus({ preventScroll: true });
      } else {
        firstAvailable?.focus();
      }
    },
  };

  return <PurchaseContext value={value}>{children}</PurchaseContext>;
}

/** Numara ızgarası + masaüstü "Sepete ekle". Radyo düğmeleri: klavyeyle ve JavaScript olmadan çalışır. */
export function SizePicker() {
  const { sizes, selected, select, soldOut, pending, formAction, onSubmit, fieldsetRef } = usePurchase();
  return (
    <form id={FORM_ID} action={formAction} onSubmit={onSubmit} className="mt-8">
      <input type="hidden" name="quantity" value="1" />
      <fieldset ref={fieldsetRef} aria-describedby="numara-ipucu">
        <legend className="label text-graphite">Numara</legend>
        <div className="mt-3 grid grid-cols-5 gap-1 sm:grid-cols-6 md:grid-cols-5">
          {sizes.map((s) => {
            const out = s.availability === "out";
            return (
              <label key={s.id} className={`relative ${out ? "cursor-not-allowed" : "cursor-pointer"}`}>
                <input
                  type="radio"
                  name="variantId"
                  value={s.id}
                  disabled={out}
                  checked={selected?.id === s.id}
                  onChange={() => select(s.id)}
                  className="peer sr-only"
                />
                <span className="tabular flex min-h-11 items-center justify-center border border-rule text-[0.8125rem] transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-enabled:hover:border-ink peer-disabled:text-ash peer-disabled:line-through">
                  {s.size}
                  {out && <span className="sr-only">, tükendi</span>}
                  {s.availability === "low" && <span className="sr-only">, son birkaç çift</span>}
                </span>
              </label>
            );
          })}
        </div>
        <p id="numara-ipucu" className="mt-2 min-h-5 text-[0.8125rem] text-graphite" aria-live="polite">
          {selected?.availability === "low" ? "Son birkaç çift" : ""}
        </p>
      </fieldset>

      <div className="hidden md:block">
        <Button type="submit" full className="mt-2" disabled={soldOut || pending}>
          {soldOut ? "Tükendi" : pending ? "Ekleniyor…" : "Sepete ekle"}
        </Button>
        <FeedbackMessage />
      </div>
    </form>
  );
}

/** Mobilde ekranın altında yapışkan çubuk. Sayfanın akışında durur; içeriğin üstünü kalıcı örtmez. */
export function MobileBuyBar() {
  const { selected, soldOut, pending } = usePurchase();
  return (
    // z-10: çerez bildirimi (z-20) ilk ziyarette bu çubuğun üstünde görünsün, kapatılınca çubuk açılır
    <div className="sticky bottom-0 z-10 border-t border-rule bg-paper px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:hidden">
      <FeedbackMessage compact />
      <div className="flex items-center gap-4">
        <p className="label min-w-0 flex-1 truncate">
          {soldOut ? "Bu renk tükendi" : selected ? `Numara ${selected.size}` : "Numara seçin"}
        </p>
        <Button type="submit" form={FORM_ID} className="flex-1" disabled={soldOut || pending}>
          {soldOut ? "Tükendi" : pending ? "Ekleniyor…" : "Sepete ekle"}
        </Button>
      </div>
    </div>
  );
}

function FeedbackMessage({ compact = false }: { compact?: boolean }) {
  const { feedback } = usePurchase();
  return (
    <div aria-live="polite" className={compact ? (feedback ? "pb-3" : "") : "mt-4 min-h-11"}>
      {feedback?.kind === "success" && (
        <div className="flex items-center justify-between gap-4">
          <p className="label">Sepete eklendi</p>
          <Link href="/sepet" className="label inline-flex min-h-11 items-center underline underline-offset-4">
            Sepete git
          </Link>
        </div>
      )}
      {feedback?.kind === "error" && (
        <p className="flex items-start gap-1.5 text-[0.8125rem]">
          <ErrorMark />
          {feedback.text}
        </p>
      )}
    </div>
  );
}
