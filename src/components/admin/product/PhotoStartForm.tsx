"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, FormNotice, SelectField, TextField } from "@/components/ui/form";

type Start = (price: unknown, manufacturerId: unknown) => Promise<{ productId?: string; colorId?: string; error?: string }>;
type Upload = (form: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;

const MAX_FILES = 6;
const MAX_BYTES = 10 * 1024 * 1024 - 8 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

/** Fiyat + fotoğraflarla taslak ürün açar; ürün sayfasında AI Asistan kendiliğinden öneri getirir. */
export function PhotoStartForm({
  start,
  upload,
  enabled,
  manufacturers,
}: {
  start: Start;
  upload: Upload;
  enabled: boolean;
  manufacturers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [price, setPrice] = useState("");
  const [manufacturerId, setManufacturerId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (files.length === 0) return setError("En az bir fotoğraf seçin.");
    if (files.length > MAX_FILES) return setError(`En fazla ${MAX_FILES} fotoğraf seçin.`);
    const big = files.find((f) => f.size > MAX_BYTES);
    if (big) return setError(`${big.name} 10 MB'tan büyük. Daha küçük bir dosya seçin.`);
    setProgress("Taslak ürün açılıyor…");
    const res = await start(price, manufacturerId).catch(() => ({ error: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin." }) as { error: string; productId?: string; colorId?: string });
    if (!res.productId || !res.colorId) {
      setProgress(null);
      return setError(res.error ?? "Taslak ürün açılamadı.");
    }
    const failed: string[] = [];
    for (const [i, f] of files.entries()) {
      setProgress(`Fotoğraflar yükleniyor… ${i + 1} / ${files.length}`);
      const form = new FormData();
      form.set("colorId", res.colorId);
      form.set("file", f);
      const r = await upload(form).catch(() => ({ ok: false as const, error: "bağlantı hatası" }));
      if (!r.ok) failed.push(`${f.name}: ${r.error}`);
    }
    // Yüklenemeyen fotoğraf olsa da ürün açıldı: ürün sayfasında eksikler eklenebilir
    router.push(`/yonetim/urunler/${res.productId}?asistan=1${failed.length ? "&eksik=1" : ""}`);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5 border border-rule p-4 md:p-5">
      <div>
        <h2 className="label">Fotoğraflarla başla</h2>
        <p className="mt-1 text-[0.8125rem] text-graphite">
          Ürünün fotoğraflarını (tek renk, en fazla {MAX_FILES}) ve satış fiyatını girin. Taslak ürün açılır; AI Asistan fotoğraflara bakıp ad, açıklama,
          malzeme, kategori, renk ve N11 özelliklerini önerir, siz seçip uygularsınız.
        </p>
      </div>
      {!enabled && <FormNotice tone="info">AI Asistan kapalı: sunucuda ANTHROPIC_API_KEY tanımlayın. Fotoğraflarla taslak yine açılır.</FormNotice>}
      {error && <FormNotice>{error}</FormNotice>}
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label="Üretici" name="uretici" value={manufacturerId} onChange={(e) => setManufacturerId(e.currentTarget.value)}>
          <option value="">Seçin</option>
          {manufacturers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Satış fiyatı (TL)" name="fiyat" inputMode="decimal" placeholder="1.299,90" value={price} onChange={(e) => setPrice(e.currentTarget.value)} />
        <label className="flex flex-col gap-2 text-[0.8125rem]">
          <span className="label">Fotoğraflar</span>
          <input
            type="file"
            accept={ACCEPT}
            multiple
            onChange={(e) => setFiles(Array.from(e.currentTarget.files ?? []))}
            className="min-h-11 text-[0.8125rem] file:mr-3 file:min-h-11 file:border file:border-ink file:bg-paper file:px-4"
          />
          {files.length > 0 && <span className="text-graphite">{files.length} fotoğraf seçildi</span>}
        </label>
      </div>
      <Button type="button" onClick={submit} disabled={progress !== null} className="w-full sm:w-auto">
        {progress ?? "Taslak aç ve öneri al"}
      </Button>
    </div>
  );
}
