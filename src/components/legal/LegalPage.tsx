import type { ReactNode } from "react";
import type { CompanyInfo } from "./company";
import { isFilled, telHref } from "./company";

export const LEGAL_UPDATED = "26.10.2026";

/** Yasal ve kurumsal sayfaların ortak düzeni: geniş başlık, güncelleme tarihi, okunaklı gövde. */
export function LegalPage({
  title,
  lead,
  updated = true,
  children,
}: {
  title: string;
  lead?: ReactNode;
  /** "Son güncelleme" satırı (yasal metinlerde) */
  updated?: boolean;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-[44rem] px-4 pt-10 md:px-0 md:pt-16">
      <header className="mb-10">
        <h1 className="wide text-lg font-[350] md:text-xl">{title}</h1>
        {updated && <p className="label mt-3 text-graphite">Son güncelleme: {LEGAL_UPDATED}</p>}
        {lead && <div className="mt-6 text-[0.9375rem] leading-relaxed">{lead}</div>}
      </header>
      <div className="prose-legal break-words">{children}</div>
    </article>
  );
}

/** Satıcı / veri sorumlusu bilgileri tablosu. */
export function CompanyDetails({ company, include }: { company: CompanyInfo; include?: (keyof CompanyInfo)[] }) {
  const rows: { key: keyof CompanyInfo; label: string; value: ReactNode }[] = [
    { key: "name", label: "Unvan", value: company.name },
    { key: "address", label: "Adres", value: company.address },
    {
      key: "phone",
      label: "Telefon",
      value: isFilled(company.phone) ? <a href={telHref(company.phone)}>{company.phone}</a> : company.phone,
    },
    {
      key: "email",
      label: "E-posta",
      value: isFilled(company.email) ? <a href={`mailto:${company.email}`}>{company.email}</a> : company.email,
    },
    { key: "kep", label: "KEP adresi", value: company.kep },
    { key: "taxOffice", label: "Vergi dairesi", value: company.taxOffice },
    { key: "taxNumber", label: "Vergi numarası", value: company.taxNumber },
    { key: "mersis", label: "MERSİS numarası", value: company.mersis },
  ];
  const shown = (include ? rows.filter((r) => include.includes(r.key)) : rows).filter((r) => r.value !== "");
  return (
    <dl className="mb-4 border-t border-rule text-[0.875rem]">
      {shown.map((r) => (
        <div key={r.key} className="grid gap-1 border-b border-rule py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
          <dt className="label pt-0.5 text-graphite">{r.label}</dt>
          <dd className="min-w-0 break-words">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
