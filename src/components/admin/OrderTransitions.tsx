"use client";

import { useActionState, useState } from "react";
import { Button, Checkbox, SelectField, TextField } from "@/components/ui/form";
import type { FormState } from "@/lib/form";
import { StateNotice, useFocusFirstError, useSubmitWithoutReset, type FormAction } from "./forms";

type Status = "awaiting_payment" | "preparing" | "shipped" | "delivered" | "cancelled" | "refunded";

type Shared = { formAction: (form: FormData) => void; pending: boolean; state: FormState; orderId: string; status: Status };

/**
 * Siparişin şu anki durumundan izinli geçişler. Tek bir işlem durumu paylaşılır: geçişten sonra
 * formlar değişse de sonuç mesajı üstte kalır.
 */
export function OrderTransitions({
  action,
  orderId,
  status,
  allowed,
  carriers,
}: {
  action: FormAction;
  orderId: string;
  status: Status;
  allowed: Status[];
  carriers: readonly string[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const shared: Shared = { formAction, pending, state, orderId, status };
  return (
    <div className="flex flex-col gap-8" aria-busy={pending}>
      <div aria-live="polite">
        <StateNotice state={state} />
      </div>
      {allowed.length === 0 && (
        <p className="text-[0.8125rem] text-graphite">Bu sipariş kapandı; durumu artık değiştirilemez.</p>
      )}
      {allowed.includes("shipped") && <ShipForm {...shared} carriers={carriers} />}
      {allowed.includes("delivered") && (
        <SimpleTransition
          {...shared}
          to="delivered"
          label="Teslim edildi olarak işaretle"
          confirm="Sipariş teslim edildi olarak işaretlensin mi?"
        />
      )}
      {allowed.includes("refunded") && <RefundForm {...shared} />}
      {allowed.includes("cancelled") && (
        <SimpleTransition
          {...shared}
          to="cancelled"
          label="Siparişi iptal et"
          variant="secondary"
          confirm={
            status === "preparing"
              ? "Sipariş iptal edilsin mi? Ürünler stoğa geri eklenir.\n\nÖdeme alınmış siparişin parasını ödeme sağlayıcısı panelinden iade etmeyi unutmayın."
              : "Sipariş iptal edilsin mi? Ürünler stoğa geri eklenir."
          }
          note={
            status === "preparing"
              ? "Ödeme alınmış siparişin parasını ödeme sağlayıcısı panelinden iade etmeyi unutmayın. İptalde ürünler stoğa geri eklenir."
              : "Ödeme henüz alınmadı. İptalde ürünler stoğa geri eklenir."
          }
        />
      )}
    </div>
  );
}

function ShipForm({ formAction, pending, state, orderId, status, carriers }: Shared & { carriers: readonly string[] }) {
  const ref = useFocusFirstError(state);
  const shipValues = state.values?.to === "shipped" && !state.ok ? state.values : undefined;
  const [carrier, setCarrier] = useState(shipValues?.carrier ?? "");
  const e = state.values?.to === "shipped" ? (state.fieldErrors ?? {}) : {};
  // Hata sonrası form sıfırlanırsa seçim kutusu ilk firmaya döner, durum ise eski firmada kalır:
  // düzeltip gönderince yanlış firma kaydedilir ve müşteriye yanlış firma yazılırdı
  const submit = useSubmitWithoutReset(formAction);
  return (
    <form ref={ref} action={formAction} onSubmit={submit} noValidate className="flex flex-col gap-5">
      <h3 className="label">Kargoya ver</h3>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="from" value={status} />
      <input type="hidden" name="to" value="shipped" />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          label="Kargo firması"
          name="carrier"
          required
          value={carrier}
          onChange={(ev) => setCarrier(ev.currentTarget.value)}
          error={e.carrier}
        >
          <option value="" disabled>
            Seçin
          </option>
          {carriers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SelectField>
        {carrier === "Diğer" && (
          <TextField
            label="Kargo firmasının adı"
            name="carrierOther"
            required
            maxLength={40}
            defaultValue={shipValues?.carrierOther}
            error={e.carrierOther}
          />
        )}
        <TextField
          label="Takip numarası"
          name="trackingNumber"
          required
          maxLength={40}
          autoCapitalize="characters"
          spellCheck={false}
          autoComplete="off"
          defaultValue={shipValues?.trackingNumber}
          error={e.trackingNumber}
          className={carrier === "Diğer" ? "sm:col-span-2" : ""}
        />
      </div>
      <div>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Kaydediliyor…" : "Kargoya ver ve müşteriye bildir"}
        </Button>
        <p className="mt-2 text-[0.75rem] text-graphite">Müşteriye kargo firması ve takip numarasıyla e-posta gönderilir.</p>
      </div>
    </form>
  );
}

function RefundForm({ formAction, pending, orderId, status }: Shared) {
  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
      onSubmit={(ev) => {
        if (!window.confirm("Sipariş iade edildi olarak işaretlensin mi? Bu geri alınamaz.")) ev.preventDefault();
      }}
    >
      <h3 className="label">İade</h3>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="from" value={status} />
      <input type="hidden" name="to" value="refunded" />
      <p className="text-[0.8125rem] text-graphite">
        Para iadesini ödeme sağlayıcısının panelinden yapın; burada yalnızca sipariş kaydı güncellenir.
      </p>
      <Checkbox name="restock" label="Ürünler geri geldi ve satılabilir durumda: stoğa geri ekle" defaultChecked />
      <div>
        <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Kaydediliyor…" : "İade edildi olarak işaretle"}
        </Button>
      </div>
    </form>
  );
}

function SimpleTransition({
  formAction,
  pending,
  orderId,
  status,
  to,
  label,
  confirm,
  note,
  variant = "primary",
}: Shared & {
  to: Status;
  label: string;
  confirm: string;
  note?: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
      onSubmit={(ev) => {
        if (!window.confirm(confirm)) ev.preventDefault();
      }}
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="from" value={status} />
      <input type="hidden" name="to" value={to} />
      {note && <p className="text-[0.8125rem] text-graphite">{note}</p>}
      <div>
        <Button type="submit" variant={variant} disabled={pending} className="w-full sm:w-auto">
          {pending ? "Kaydediliyor…" : label}
        </Button>
      </div>
    </form>
  );
}
