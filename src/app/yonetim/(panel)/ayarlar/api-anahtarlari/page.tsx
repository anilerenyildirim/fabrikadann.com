import type { Metadata } from "next";
import { ActionButton } from "@/components/admin/forms";
import { ExpiryForm, IntegrationKeyForm } from "@/components/admin/IntegrationForms";
import { formatDateTime, PageHeader } from "@/components/admin/ui";
import { ErrorMark, FormNotice } from "@/components/ui/form";
import { requireAdmin } from "@/server/auth/current";
import { secretsEnabled } from "@/server/secrets";
import { listIntegrations, type IntegrationRow } from "@/server/services/admin/integrations";
import { checkNowAction, clearKeysAction, saveKeysAction, setExpiryAction } from "./actions";

export const metadata: Metadata = { title: "API anahtarları" };

function status(r: IntegrationRow): string {
  if (!r.configured) return "Tanımlı değil";
  if (r.ok === true) return "Çalışıyor";
  if (r.ok === false) return `Çalışmıyor: ${r.message ?? ""}`;
  return "Tanımlı (henüz denenmedi)";
}

function expiryText(r: IntegrationRow): string | null {
  if (r.daysLeft === null || !r.expiresAt) return null;
  const date = new Date(`${r.expiresAt}T12:00:00Z`).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
  if (r.daysLeft < 0) return `Süresi ${date} tarihinde doldu`;
  if (r.daysLeft === 0) return `Süresi bugün (${date}) doluyor`;
  return `${date} tarihine kadar geçerli (${r.daysLeft} gün kaldı)`;
}

export default async function ApiKeysPage() {
  await requireAdmin();
  const [rows, canStore] = await Promise.all([listIntegrations(), Promise.resolve(secretsEnabled())]);
  return (
    <>
      <PageHeader
        title="API anahtarları"
        back={{ href: "/yonetim/ayarlar", label: "Ayarlar" }}
        description="Bağlantılar saatte bir kendiliğinden denenir. Çalışmayan bağlantı ve süresi dolmak üzere olan anahtar (7, 3 ve 1 gün kala) telefonunuza bildirilir. Anahtarların kendisi hiçbir yerde gösterilmez; yalnızca son 4 karakteri."
        actions={<ActionButton action={checkNowAction} fields={{}} label="Şimdi dene" pendingLabel="Deneniyor…" variant="secondary" />}
      />
      {!canStore && (
        <div className="mb-6">
          <FormNotice tone="info">Panelden anahtar girişi kapalı: sunucuda SECRETS_KEY tanımlı değil. Durum ve son kullanma takibi çalışır.</FormNotice>
        </div>
      )}
      <ul className="max-w-3xl border-t border-ink">
        {rows.map((r) => {
          const warn = (r.configured && r.ok === false) || (r.daysLeft !== null && r.daysLeft <= 7);
          const expiry = expiryText(r);
          return (
            <li key={r.id} className={`flex flex-col gap-4 border-b border-rule px-3 py-5 ${warn ? "bg-caution/5" : ""}`}>
              <div className="text-[0.8125rem]">
                <p className="flex items-start gap-1.5 font-medium">
                  {warn && <ErrorMark />}
                  {r.name}
                </p>
                <p className="text-graphite">{r.purpose}</p>
                <p className="mt-2">{status(r)}</p>
                {expiry && <p className={r.daysLeft !== null && r.daysLeft <= 7 ? "font-medium" : "text-graphite"}>{expiry}</p>}
                <p className="mt-1 text-graphite">
                  {[...r.secrets.map((s) => (s.source ? `${s.name}: ${s.source === "panel" ? "panelden" : "sunucu dosyasından"} (…${s.last4})` : `${s.name}: yok`)),
                    ...r.env.map((e) => `${e.name}: ${e.source ? "sunucu dosyasında" : "yok"}`)].join(" · ")}
                </p>
                {r.checkedAt && <p className="text-graphite">Son deneme: {formatDateTime(r.checkedAt)}</p>}
              </div>
              <ExpiryForm id={r.id} value={r.expiresAt} action={setExpiryAction} />
              {r.editable && canStore && (
                <details className="border border-rule p-3">
                  <summary className="label flex min-h-11 cursor-pointer items-center">Anahtarı değiştir</summary>
                  <div className="mt-3 flex flex-col gap-4">
                    <IntegrationKeyForm id={r.id} names={r.secrets.map((s) => s.name)} action={saveKeysAction} />
                    {r.secrets.some((s) => s.source === "panel") && (
                      <ActionButton
                        action={clearKeysAction}
                        fields={{ id: r.id }}
                        label="Paneldeki anahtarı kaldır"
                        variant="quiet"
                        confirm="Paneldeki anahtar silinsin mi? Sunucu dosyasında anahtar yoksa bu bağlantı çalışmaz."
                      />
                    )}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
