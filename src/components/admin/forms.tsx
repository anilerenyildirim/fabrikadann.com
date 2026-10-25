"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, ErrorMark, FormNotice } from "@/components/ui/form";
import type { FormState } from "@/lib/form";

export type FormAction = (prev: FormState, form: FormData) => Promise<FormState>;

/**
 * React 19, form action'ı bitince formu kendiliğinden sıfırlar. <select> alanları bu sıfırlamada
 * ilk açılıştaki (ya da ilk etkin) seçeneğe döner ve React güncel değeri geri yazmaz: kullanıcının
 * seçimi ekranda sessizce değişir, sonraki gönderimde yanlış değer gider. Seçim kutusu olan formlar
 * gönderimi bununla yapar; form sıfırlanmaz, girilen değerler yerinde kalır. JS yokken form yine
 * action özniteliğiyle gönderilir.
 */
export function useSubmitWithoutReset(formAction: (form: FormData) => void, confirmMessage?: string) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  };
}

/**
 * Her başarılı sonuçta artan sayı. Sıfırlanmayan formlarda, başarıdan sonra alanları sunucudaki
 * yeni değerlerle yeniden kurmak için key olarak kullanılır.
 */
export function useSuccessKey(state: FormState): number {
  const [seen, setSeen] = useState({ state, n: 0 });
  if (seen.state !== state) {
    const n = state.ok ? seen.n + 1 : seen.n;
    setSeen({ state, n });
    return n;
  }
  return seen.n;
}

/** Formun genel hatası ya da (öncelikli alanlardan başlayarak) ilk alan hatası. */
export function firstError(state: FormState, preferred: string[] = []): string | undefined {
  if (state.error) return state.error;
  const errors = state.fieldErrors ?? {};
  for (const key of preferred) if (errors[key]) return errors[key];
  return Object.values(errors)[0];
}

/** Sunucudan alan hatası dönünce ilk hatalı alana odaklanır. */
export function useFocusFirstError(state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.fieldErrors) return;
    ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);
  return ref;
}

/** Formun üstündeki genel hata ya da başarı mesajı. */
export function StateNotice({ state }: { state: FormState }) {
  if (state.error) return <FormNotice>{state.error}</FormNotice>;
  if (state.ok && state.message) return <FormNotice tone="info">{state.message}</FormNotice>;
  return null;
}

/** Genel hata dışında kalan alan hatalarını (formda karşılığı olmayan) gösterir. */
export function LooseFieldErrors({ state, known }: { state: FormState; known: string[] }) {
  const loose = Object.entries(state.fieldErrors ?? {}).filter(([k]) => !known.includes(k));
  if (loose.length === 0) return null;
  return (
    <FormNotice>
      {loose.map(([k, v]) => (
        <span key={k} className="block">
          {v}
        </span>
      ))}
    </FormNotice>
  );
}

export function InlineError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[0.8125rem] text-ink">
      <ErrorMark />
      {message}
    </p>
  );
}

export function InlineOk({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="mt-1.5 text-[0.8125rem] text-graphite">
      {message}
    </p>
  );
}

/**
 * Tek düğmelik işlem (sil, taşı, arşivle…): gizli alanlarla Server Action çağırır, hatayı düğmenin
 * altında gösterir. confirm verilirse önce onay ister.
 */
export function ActionButton({
  action,
  fields,
  label,
  pendingLabel,
  confirm,
  variant = "secondary",
  ariaLabel,
  className = "",
  buttonClassName = "",
  children,
}: {
  action: FormAction;
  fields: Record<string, string>;
  label: ReactNode;
  pendingLabel?: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "quiet";
  ariaLabel?: string;
  className?: string;
  buttonClassName?: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <Button
        type="submit"
        variant={variant}
        disabled={pending}
        aria-label={ariaLabel}
        className={`${variant === "quiet" ? "" : "min-h-11 px-4"} ${buttonClassName}`}
      >
        {pending && pendingLabel ? pendingLabel : label}
      </Button>
      <InlineError message={firstError(state)} />
      <InlineOk message={state.ok ? state.message : undefined} />
    </form>
  );
}

/** Küçük, kare yukarı/aşağı düğmesi (sıralama). */
export function MoveButtons({
  action,
  fields,
  isFirst,
  isLast,
  what,
}: {
  action: FormAction;
  fields: Record<string, string>;
  isFirst: boolean;
  isLast: boolean;
  what: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const btn =
    "inline-flex size-11 items-center justify-center border border-rule hover:border-ink disabled:cursor-not-allowed disabled:text-ash disabled:hover:border-rule";
  return (
    <form action={formAction} className="flex flex-col">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="flex gap-1">
        <button
          type="submit"
          name="direction"
          value="up"
          disabled={pending || isFirst}
          className={btn}
          aria-label={`${what}: yukarı taşı`}
        >
          <Arrow up />
        </button>
        <button
          type="submit"
          name="direction"
          value="down"
          disabled={pending || isLast}
          className={btn}
          aria-label={`${what}: aşağı taşı`}
        >
          <Arrow />
        </button>
      </div>
      <InlineError message={firstError(state)} />
    </form>
  );
}

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" className={`size-3 ${up ? "" : "rotate-180"}`} aria-hidden="true">
      <path d="M6 1.5v9M2 5.5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}
