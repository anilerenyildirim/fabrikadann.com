import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/admin/forms";
import { LedgerEntryForm } from "@/components/admin/LedgerEntryForm";
import { MonthNav } from "@/components/admin/MonthNav";
import { Empty, FilterLinks, formatDate, PageHeader, pageParam, Pager, param, qs, Section, table, TableWrap, td, th } from "@/components/admin/ui";
import { formatPrice } from "@/lib/money";
import { requireAdmin } from "@/server/auth/current";
import { monthRange } from "@/server/services/admin/accounting";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  listLedgerEntries,
  PAYMENT_METHODS,
} from "@/server/services/admin/ledger";
import { manufacturerOptions } from "@/server/services/admin/manufacturers";
import { istanbulDate } from "@/server/services/admin/purchases";
import { createLedgerEntryAction, deleteLedgerEntryAction } from "../actions";

export const metadata: Metadata = { title: "Gelir ve giderler" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const METHOD_LABELS: Record<string, string> = PAYMENT_METHODS;

export default async function LedgerPage({ searchParams }: Props) {
  await requireAdmin();
  const sp = await searchParams;
  const { month, from, to } = monthRange(param(sp.ay, 7));
  const kindParam = param(sp.tur, 10);
  const kind = kindParam === "income" || kindParam === "expense" ? kindParam : undefined;
  const [list, manufacturers] = await Promise.all([
    listLedgerEntries({ from, to, kind, page: pageParam(sp.sayfa) }),
    manufacturerOptions(),
  ]);
  const income = list.rows.filter((r) => r.kind === "income").reduce((n, r) => n + r.amount, 0);
  const expense = list.rows.filter((r) => r.kind === "expense").reduce((n, r) => n + r.amount, 0);

  return (
    <>
      <PageHeader
        title="Gelir ve giderler"
        back={{ href: "/yonetim/muhasebe", label: "Muhasebe" }}
        description="Site satışları siparişlerden otomatik hesaplanır; buraya girmeyin. Trendyol hakedişini, kargo, kira, reklam gibi giderleri ve üretici ödemelerini girin."
      />
      <Section title="Yeni kayıt">
        <LedgerEntryForm
          action={createLedgerEntryAction}
          incomeCategories={INCOME_CATEGORIES}
          expenseCategories={EXPENSE_CATEGORIES}
          methods={PAYMENT_METHODS}
          manufacturers={manufacturers}
          today={istanbulDate()}
        />
      </Section>
      <Section title="Kayıtlar">
        <MonthNav base="/yonetim/muhasebe/gelir-gider" month={month} current={istanbulDate().slice(0, 7)} extra={{ tur: kind }} />
        <FilterLinks
          label="Tür"
          current={kind ?? "all"}
          items={[
            { value: "all", label: "Tümü" },
            { value: "income", label: "Gelir" },
            { value: "expense", label: "Gider" },
          ].map((f) => ({ ...f, href: qs("/yonetim/muhasebe/gelir-gider", { ay: month, tur: f.value === "all" ? undefined : f.value }) }))}
        />
        {list.rows.length === 0 ? (
          <Empty>Bu dönemde kayıt yok.</Empty>
        ) : (
          <TableWrap label="Gelir ve gider kayıtları">
            <table className={`${table} min-w-[760px]`}>
              <thead>
                <tr>
                  <th className={th}>Tarih</th>
                  <th className={th}>Kategori</th>
                  <th className={th}>Açıklama</th>
                  <th className={th}>Ödeme</th>
                  <th className={`${th} text-right`}>Tutar</th>
                  <th className={`${th} w-16`}>
                    <span className="sr-only">Sil</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id}>
                    <td className={`${td} tabular whitespace-nowrap`}>{formatDate(`${r.date}T12:00:00Z`)}</td>
                    <td className={td}>
                      {CATEGORY_LABELS[r.category] ?? r.category}
                      {r.manufacturerId && (
                        <Link href={`/yonetim/ureticiler/${r.manufacturerId}`} className="flex min-h-11 items-center text-[0.75rem] text-graphite underline underline-offset-4">
                          {r.manufacturerName}
                        </Link>
                      )}
                    </td>
                    <td className={`${td} break-words text-graphite`}>{r.description || "—"}</td>
                    <td className={`${td} text-graphite`}>{METHOD_LABELS[r.method] ?? r.method}</td>
                    <td className={`${td} tabular text-right whitespace-nowrap`}>
                      {r.kind === "expense" ? "−" : "+"}
                      {formatPrice(r.amount)}
                    </td>
                    <td className={td}>
                      <ActionButton
                        action={deleteLedgerEntryAction}
                        fields={{ entryId: r.id }}
                        label="Sil"
                        ariaLabel={`${formatDate(`${r.date}T12:00:00Z`)} tarihli ${formatPrice(r.amount)} kaydını sil`}
                        pendingLabel="…"
                        variant="quiet"
                        confirm={`${formatPrice(r.amount)} tutarındaki kayıt silinsin mi? Silinen kayıt işlem günlüğünde kalır.`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              {list.pageCount === 1 && (
                <tfoot>
                  <tr>
                    <td className={`${td} border-ink`} colSpan={4}>
                      Gelir {formatPrice(income)} · Gider {formatPrice(expense)}
                    </td>
                    <td className={`${td} tabular border-ink text-right font-medium whitespace-nowrap`}>
                      {income - expense < 0 ? "−" : ""}
                      {formatPrice(Math.abs(income - expense))}
                    </td>
                    <td className={`${td} border-ink`} />
                  </tr>
                </tfoot>
              )}
            </table>
          </TableWrap>
        )}
        <Pager
          page={list.page}
          pageCount={list.pageCount}
          total={list.total}
          unit="kayıt"
          hrefFor={(p) => qs("/yonetim/muhasebe/gelir-gider", { ay: month, tur: kind, sayfa: p })}
        />
      </Section>
    </>
  );
}
