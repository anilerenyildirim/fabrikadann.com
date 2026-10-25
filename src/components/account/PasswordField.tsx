"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { TextField } from "@/components/ui/form";

type Props = Omit<ComponentProps<"input">, "type"> & {
  label: string;
  name: string;
  error?: string | null;
  hint?: ReactNode;
};

/** Parola alanı; telefonda yazılanı kontrol edebilmek için "Göster" düğmesi var. */
export function PasswordField({ label, name, id, style, ...props }: Props) {
  const [visible, setVisible] = useState(false);
  const fieldId = id ?? `alan-${name}`;
  return (
    <div className="relative">
      <TextField
        {...props}
        id={fieldId}
        name={name}
        label={label}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        style={{ ...style, paddingRight: "4.5rem" }}
      />
      {/* Etiketin (1rem) hemen altında, alanın sağında */}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-controls={fieldId}
        aria-label={visible ? `${label}: gizle` : `${label}: göster`}
        className="label absolute right-0 top-4 flex min-h-11 min-w-11 items-center justify-end text-graphite hover:text-ink"
      >
        {visible ? "Gizle" : "Göster"}
      </button>
    </div>
  );
}
