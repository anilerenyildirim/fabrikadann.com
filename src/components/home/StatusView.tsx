import type { ReactNode } from "react";

/** 404 ve hata sayfalarının ortak düzeni: küçük etiket, geniş başlık, kısa açıklama, eylemler. */
export function StatusView({
  eyebrow,
  title,
  children,
  actions,
  footnote,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <section className="mx-auto flex min-h-[60svh] max-w-xl flex-col items-center justify-center px-6 py-20 text-center md:py-28">
      <p className="label text-graphite">{eyebrow}</p>
      <h1 className="wide mt-4 text-base leading-snug md:text-lg">{title}</h1>
      <div className="mt-4 text-[0.9375rem] leading-relaxed text-graphite">{children}</div>
      <div className="mt-10 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-center">
        {actions}
      </div>
      {footnote && <div className="label mt-10 text-ash">{footnote}</div>}
    </section>
  );
}
