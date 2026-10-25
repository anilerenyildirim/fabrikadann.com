"use client";

import { useActionState } from "react";
import { updateCartLine } from "@/app/(magaza)/sepet/actions";
import { ErrorMark } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import type { CartLine } from "@/server/services/cart";

type Props = {
  lineId: string;
  productName: string;
  quantity: number;
  maxQuantity: number;
  maxPerLine: number;
  problem: CartLine["problem"];
};

const initial: FormState = {};

/** Adet − / + ve "Kaldır". JavaScript olmadan da çalışır (düz form gönderimi). */
export function CartLineControls({ lineId, productName, quantity, maxQuantity, maxPerLine, problem }: Props) {
  const [state, action, pending] = useActionState(updateCartLine, initial);
  const canIncrease = !problem && quantity < maxQuantity;
  const limitHint =
    !problem && quantity >= maxQuantity
      ? maxQuantity >= maxPerLine
        ? `Bir üründen en fazla ${maxPerLine} adet alınabilir.`
        : "Stoktaki adedin tamamı sepetinizde."
      : null;

  return (
    <div className="mt-auto pt-3">
      <form action={action} aria-busy={pending} className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <input type="hidden" name="lineId" value={lineId} />

        {problem === "insufficient_stock" && maxQuantity > 0 ? (
          <button
            type="submit"
            name="quantity"
            value={maxQuantity}
            disabled={pending}
            className="label inline-flex min-h-11 items-center border border-ink px-4 hover:bg-fog disabled:border-ash disabled:text-ash"
          >
            Adedi {maxQuantity} yap
          </button>
        ) : problem ? (
          <span className="label text-graphite tabular">Adet {quantity}</span>
        ) : (
          <div role="group" aria-label={`${productName} adedi`} className="flex items-center border border-rule">
            <StepButton
              value={quantity - 1}
              disabled={pending || quantity <= 1}
              label="Bir azalt"
            >
              <path d="M5 12h14" />
            </StepButton>
            <output className="tabular w-8 text-center text-[0.8125rem]" aria-live="polite">
              {quantity}
            </output>
            <StepButton value={quantity + 1} disabled={pending || !canIncrease} label="Bir artır">
              <path d="M5 12h14M12 5v14" />
            </StepButton>
          </div>
        )}

        <button
          type="submit"
          name="quantity"
          value={0}
          disabled={pending}
          className="label inline-flex min-h-11 items-center text-graphite underline-offset-4 hover:text-ink hover:underline disabled:text-ash"
        >
          Kaldır<span className="sr-only">: {productName}</span>
        </button>
      </form>

      {limitHint && !state.error && <p className="mt-1 text-[0.75rem] text-graphite">{limitHint}</p>}
      {state.error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-[0.8125rem]">
          <ErrorMark />
          {state.error}
        </p>
      )}
    </div>
  );
}

function StepButton({
  value,
  disabled,
  label,
  children,
}: {
  value: number;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      name="quantity"
      value={value}
      disabled={disabled}
      aria-label={label}
      className="flex size-11 items-center justify-center hover:bg-fog disabled:cursor-not-allowed disabled:text-ash disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
