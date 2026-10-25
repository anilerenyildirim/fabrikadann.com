"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { placeOrder, type CheckoutState } from "@/app/(magaza)/odeme/actions";
import { AddressFields } from "@/components/ui/AddressFields";
import { Button, Checkbox, ErrorMark, FormNotice, TextField } from "@/components/ui/form";

export type CheckoutAddress = {
  id: string;
  title: string;
  fullName: string;
  phone: string;
  city: string;
  district: string;
  line: string;
};

type Props = {
  /** Giriş yapılmışsa hesabın e-postası; misafirde null */
  signedInEmail: string | null;
  addresses: CheckoutAddress[];
  /** Hesaptaki adres sınırı dolmadıysa "Bu adresi hesabıma kaydet" gösterilir */
  canSaveAddress: boolean;
  prefill: { fullName?: string; phone?: string };
  totalText: string;
  /** Sayfada gösterilen sepetin parmak izi; sunucu bununla sepetin değişmediğini doğrular */
  cartSig: string;
};

const NEW = "new";
const initial: CheckoutState = {};

/*
  Seçimler (adres kartı, "adresi kaydet") denetimsiz alanlardır ve neyin görüneceğine CSS :has()
  karar verir: JavaScript'siz de çalışır, React'in eylem sonrası form sıfırlaması da seçimi
  bozmaz. Alanlar her sunucu yanıtında yeniden kurulur (key) ki sıfırlama, geri gelen değerlere
  dönsün (ör. il seçimi "Seçin"e düşmesin).
*/
export function CheckoutForm({ signedInEmail, addresses, canSaveAddress, prefill, totalText, cartSig }: Props) {
  const [state, action, pending] = useActionState(placeOrder, initial);
  const v = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  const signedIn = signedInEmail !== null;
  const hasSaved = signedIn && addresses.length > 0;

  // Her yeni sunucu yanıtında alanları yeniden kur
  const [round, setRound] = useState({ state, n: 0 });
  if (round.state !== state) setRound({ state, n: round.n + 1 });

  const selectedId =
    v.addressId === NEW || addresses.some((a) => a.id === v.addressId) ? v.addressId! : (addresses[0]?.id ?? NEW);
  // Kayıtlı adresi olmayan üyeye adresi kaydetmeyi varsayılan olarak öner
  const saveDefault = state.values ? v.saveAddress === "on" : addresses.length === 0;

  const formRef = useRef<HTMLFormElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  // Hata sonrası odak: ilk hatalı alan, yoksa hata kutusu
  useEffect(() => {
    if (!state.error) return;
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid && invalid.offsetParent !== null) invalid.focus();
    else noticeRef.current?.focus();
  }, [state]);

  const addressValues = {
    fullName: v.fullName ?? prefill.fullName,
    phone: v.phone ?? prefill.phone,
    city: v.city,
    district: v.district,
    line: v.line,
  };

  return (
    // noValidate: hatalar tarayıcı balonu yerine sunucudan, alanın altında ve sitenin diliyle gösterilir
    <form ref={formRef} action={action} noValidate>
      <input type="hidden" name="cartSig" value={cartSig} />
      <div key={round.n} className="space-y-12">
        <section aria-labelledby="odeme-iletisim">
          <SectionTitle id="odeme-iletisim" step={1}>
            İletişim
          </SectionTitle>
          {signedIn ? (
            <p className="text-[0.8125rem]">
              Sipariş onayını ve kargo bilgisini <span className="font-medium break-all">{signedInEmail}</span>{" "}
              adresine göndereceğiz.
            </p>
          ) : (
            <div className="space-y-4">
              <TextField
                label="E-posta"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                defaultValue={v.email}
                error={errors.email}
                hint="Sipariş onayını ve kargo bilgisini bu adrese göndereceğiz."
                required
              />
              <p className="text-[0.8125rem] text-graphite">
                Hesabınız var mı?{" "}
                <Link
                  href="/giris?sonra=%2Fodeme"
                  className="inline-flex min-h-11 items-center text-ink underline underline-offset-4"
                >
                  Giriş yapın
                </Link>
              </p>
            </div>
          )}
        </section>

        <section aria-labelledby="odeme-adres" className="group/adres">
          <SectionTitle id="odeme-adres" step={2}>
            Teslimat adresi
          </SectionTitle>

          {hasSaved && (
            <fieldset className="mb-8" aria-describedby={errors.addressId ? "adres-secimi-hata" : undefined}>
              <legend className="sr-only">Kayıtlı adreslerden birini seçin ya da yeni adres girin</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {addresses.map((a) => (
                  <AddressOption key={a.id} value={a.id} defaultChecked={selectedId === a.id} title={a.title}>
                    <span className="block">{a.fullName}</span>
                    <span className="block text-graphite">{a.line}</span>
                    <span className="block text-graphite">
                      {a.district} / {a.city}
                    </span>
                    <span className="tabular block text-graphite">{a.phone}</span>
                  </AddressOption>
                ))}
                <AddressOption id="adres-yeni" value={NEW} defaultChecked={selectedId === NEW} title="Yeni adres">
                  <span className="text-graphite">Başka bir adrese gönder</span>
                </AddressOption>
              </div>
              {errors.addressId && (
                <p id="adres-secimi-hata" role="alert" className="mt-2 flex items-start gap-1.5 text-[0.8125rem]">
                  <ErrorMark />
                  {errors.addressId}
                </p>
              )}
            </fieldset>
          )}

          {/* Kayıtlı adres seçiliyken gizli; gönderilse de sunucu yok sayar */}
          <div className={hasSaved ? "hidden space-y-6 group-has-[#adres-yeni:checked]/adres:block" : "space-y-6"}>
            <AddressFields values={addressValues} errors={errors} />
            {signedIn && canSaveAddress && (
              <div className="group/kaydet space-y-4">
                <Checkbox
                  id="adres-kaydet"
                  name="saveAddress"
                  label="Bu adresi hesabıma kaydet"
                  defaultChecked={saveDefault}
                />
                <div className="hidden group-has-[#adres-kaydet:checked]/kaydet:block">
                  <TextField
                    label="Adres adı (isteğe bağlı)"
                    name="title"
                    placeholder="Ev, iş…"
                    maxLength={40}
                    defaultValue={v.title}
                    error={errors.title}
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="odeme-onay">
          <SectionTitle id="odeme-onay" step={3}>
            Onay ve ödeme
          </SectionTitle>
          <Checkbox
            name="terms"
            required
            defaultChecked={v.terms === "on"}
            error={errors.terms}
            label={
              <>
                <a href="/on-bilgilendirme" target="_blank" rel="noopener" className="underline underline-offset-2">
                  Ön bilgilendirme formunu
                  <span className="sr-only"> (yeni sekmede açılır)</span>
                </a>{" "}
                ve{" "}
                <a href="/mesafeli-satis" target="_blank" rel="noopener" className="underline underline-offset-2">
                  mesafeli satış sözleşmesini
                  <span className="sr-only"> (yeni sekmede açılır)</span>
                </a>{" "}
                okudum, onaylıyorum.
              </>
            }
          />

          {state.error && (
            <div ref={noticeRef} tabIndex={-1} className="mt-6 outline-none">
              <FormNotice>
                <p>{state.error}</p>
                {state.details && state.details.length > 0 && (
                  <ul className="mt-2 list-[square] pl-4">
                    {state.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
                {state.openOrders && state.openOrders.length > 0 && (
                  <ul className="mt-1">
                    {state.openOrders.map((n) => (
                      <li key={n}>
                        <Link
                          href={`/siparis/${n}`}
                          className="inline-flex min-h-11 items-center underline underline-offset-4"
                        >
                          <span className="tabular">{n}</span>&nbsp;siparişinin ödemesini tamamla
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {state.backToCart && (
                  <Link
                    href="/sepet"
                    className="label mt-1 inline-flex min-h-11 items-center underline underline-offset-4"
                  >
                    Sepete dön ve düzenle
                  </Link>
                )}
              </FormNotice>
            </div>
          )}

          <div className="mt-6">
            <Button type="submit" full disabled={pending} aria-describedby="odeme-toplam">
              {pending ? "Sipariş oluşturuluyor…" : "Siparişi onayla ve öde"}
            </Button>
            <p id="odeme-toplam" className="mt-3 text-[0.75rem] text-graphite">
              Ödenecek tutar <span className="tabular text-ink">{totalText}</span>. Sonraki adımda ödeme sayfasına
              yönlendirileceksiniz.
            </p>
          </div>
        </section>
      </div>
    </form>
  );
}

function SectionTitle({ id, step, children }: { id: string; step: number; children: React.ReactNode }) {
  return (
    <h2 id={id} className="label mb-6 flex items-baseline gap-3">
      <span className="tabular text-graphite">{step}</span>
      {children}
    </h2>
  );
}

function AddressOption({
  id,
  value,
  defaultChecked,
  title,
  children,
}: {
  id?: string;
  value: string;
  defaultChecked: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 border border-rule p-4 text-[0.8125rem] transition-colors hover:border-ash has-[:checked]:border-ink">
      <input
        id={id}
        type="radio"
        name="addressId"
        value={value}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-[18px] shrink-0 cursor-pointer appearance-none rounded-full border border-ink bg-paper checked:border-[6px]"
      />
      <span className="min-w-0 break-words">
        <span className="label mb-1 block">{title}</span>
        {children}
      </span>
    </label>
  );
}
