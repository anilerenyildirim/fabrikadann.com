import { CITIES } from "@/data/iller";
import { SelectField, TextArea, TextField } from "./form";

type Values = Partial<Record<"title" | "fullName" | "phone" | "city" | "district" | "line", string>>;

/** Adres alanları; hem ödeme sayfasında hem "Adreslerim"de kullanılır. */
export function AddressFields({
  values = {},
  errors = {},
  withTitle = false,
  prefix = "",
}: {
  values?: Values;
  errors?: Record<string, string>;
  withTitle?: boolean;
  /** Aynı formda birden çok adres olursa alan adlarına önek */
  prefix?: string;
}) {
  const n = (k: string) => `${prefix}${k}`;
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {withTitle && (
        <TextField
          className="sm:col-span-2"
          label="Adres adı"
          name={n("title")}
          placeholder="Ev, iş…"
          defaultValue={values.title}
          error={errors[n("title")]}
          maxLength={40}
          required
        />
      )}
      <TextField
        label="Ad soyad"
        name={n("fullName")}
        autoComplete="name"
        defaultValue={values.fullName}
        error={errors[n("fullName")]}
        maxLength={80}
        required
      />
      <TextField
        label="Telefon"
        name={n("phone")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="05xx xxx xx xx"
        defaultValue={values.phone}
        error={errors[n("phone")]}
        maxLength={20}
        required
      />
      <SelectField label="İl" name={n("city")} defaultValue={values.city ?? ""} error={errors[n("city")]} required>
        <option value="" disabled>
          Seçin
        </option>
        {CITIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </SelectField>
      <TextField
        label="İlçe"
        name={n("district")}
        autoComplete="address-level2"
        defaultValue={values.district}
        error={errors[n("district")]}
        maxLength={60}
        required
      />
      <TextArea
        className="sm:col-span-2"
        label="Adres"
        name={n("line")}
        autoComplete="street-address"
        placeholder="Mahalle, sokak, bina no, daire no"
        defaultValue={values.line}
        error={errors[n("line")]}
        maxLength={300}
        rows={3}
        required
      />
    </div>
  );
}
