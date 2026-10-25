import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "quiet";

const buttonBase =
  "label inline-flex min-h-12 items-center justify-center gap-2 px-6 transition-colors duration-150 disabled:cursor-not-allowed select-none";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-night disabled:bg-ash",
  secondary: "border border-ink bg-paper text-ink hover:bg-fog disabled:border-ash disabled:text-ash",
  quiet: "text-ink underline-offset-4 hover:underline disabled:text-ash px-0 min-h-11",
};

export function buttonClass(variant: ButtonVariant = "primary", full = false, extra = "") {
  return `${buttonBase} ${buttonVariants[variant]} ${full ? "w-full" : ""} ${extra}`;
}

export function Button({
  variant = "primary",
  full = false,
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; full?: boolean }) {
  return <button {...props} className={buttonClass(variant, full, className)} />;
}

export function ButtonLink({
  variant = "primary",
  full = false,
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; full?: boolean }) {
  return <Link {...props} className={buttonClass(variant, full, className)} />;
}

type FieldProps = ComponentProps<"input"> & {
  label: string;
  error?: string | null;
  hint?: ReactNode;
};

/** Zara gibi: üstte küçük etiket, altta tek çizgi. */
export function TextField({ label, error, hint, id, name, className = "", ...props }: FieldProps) {
  const fieldId = id ?? `alan-${name}`;
  const describedBy = error ? `${fieldId}-hata` : hint ? `${fieldId}-ipucu` : undefined;
  return (
    <div className={`flex flex-col ${className}`}>
      <label htmlFor={fieldId} className="label text-graphite">
        {label}
      </label>
      <input
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-11 border-0 border-b bg-transparent px-0 py-2 outline-none transition-colors placeholder:text-ash focus:border-ink focus-visible:outline-none ${
          error ? "border-ink border-b-2" : "border-ash"
        }`}
        {...props}
      />
      <FieldMessage id={describedBy} error={error} hint={hint} />
    </div>
  );
}

export function SelectField({
  label,
  error,
  id,
  name,
  className = "",
  children,
  ...props
}: ComponentProps<"select"> & { label: string; error?: string | null }) {
  const fieldId = id ?? `alan-${name}`;
  return (
    <div className={`flex flex-col ${className}`}>
      <label htmlFor={fieldId} className="label text-graphite">
        {label}
      </label>
      <select
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-hata` : undefined}
        className={`min-h-11 appearance-none rounded-none border-0 border-b bg-transparent bg-[length:10px] bg-[right_2px_center] bg-no-repeat px-0 py-2 pr-6 outline-none focus:border-ink ${
          error ? "border-ink border-b-2" : "border-ash"
        }`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6' fill='none' stroke='%23000'/%3E%3C/svg%3E\")",
        }}
        {...props}
      >
        {children}
      </select>
      <FieldMessage id={error ? `${fieldId}-hata` : undefined} error={error} />
    </div>
  );
}

export function TextArea({
  label,
  error,
  id,
  name,
  className = "",
  ...props
}: ComponentProps<"textarea"> & { label: string; error?: string | null }) {
  const fieldId = id ?? `alan-${name}`;
  return (
    <div className={`flex flex-col ${className}`}>
      <label htmlFor={fieldId} className="label text-graphite">
        {label}
      </label>
      <textarea
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        className={`min-h-24 border bg-transparent p-3 outline-none focus:border-ink ${error ? "border-ink border-2" : "border-ash"}`}
        {...props}
      />
      <FieldMessage id={error ? `${fieldId}-hata` : undefined} error={error} />
    </div>
  );
}

function FieldMessage({ id, error, hint }: { id?: string; error?: string | null; hint?: ReactNode }) {
  if (error) {
    return (
      <p id={id} className="mt-1.5 flex items-start gap-1.5 text-[0.8125rem] text-ink" role="alert">
        <ErrorMark />
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p id={id} className="mt-1.5 text-[0.8125rem] text-graphite">
        {hint}
      </p>
    );
  }
  return null;
}

/** Renk kullanmadan hatayı işaretleyen küçük daire içinde ünlem. */
export function ErrorMark() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 size-3.5 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4v5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="11.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function Checkbox({
  label,
  error,
  id,
  name,
  className = "",
  ...props
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode; error?: string | null }) {
  const fieldId = id ?? `alan-${name}`;
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
        <input
          id={fieldId}
          name={name}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          className="peer mt-0.5 size-[18px] shrink-0 cursor-pointer appearance-none border border-ink bg-paper checked:bg-ink"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Cpath d='M4 9.5l3.2 3L14 5.5' fill='none' stroke='%23fff' stroke-width='1.6'/%3E%3C/svg%3E\")",
          }}
          {...props}
        />
        <span className="text-[0.8125rem] leading-snug">{label}</span>
      </label>
      <FieldMessage id={error ? `${fieldId}-hata` : undefined} error={error} />
    </div>
  );
}

/** Formun genel hata/bilgi kutusu. */
export function FormNotice({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 border px-4 py-3 text-[0.8125rem] ${tone === "error" ? "border-ink" : "border-rule bg-fog"}`}
    >
      {tone === "error" && <ErrorMark />}
      <div>{children}</div>
    </div>
  );
}
