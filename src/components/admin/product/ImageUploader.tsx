"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { InlineError } from "../forms";

type UploadAction = (form: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;

// Sunucu sınırı 10 MB; proxy de istek gövdesini 10 MB'ta keser (proxyClientMaxBodySize), bu yüzden
// form alanlarının payı kadar altında kalınır ve kullanıcı yükleme denemeden uyarılır.
const MAX_BYTES = 10 * 1024 * 1024 - 8 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

/**
 * Bir renge çoklu görsel yükleme. Dosyalar sırayla, her biri ayrı istekle gönderilir; biri hatalı
 * olsa da diğerleri yüklenir. Sunucu her dosyayı yeniden doğrular.
 */
export function ImageUploader({ colorId, colorName, action }: { colorId: string; colorName: string; action: UploadAction }) {
  const id = useId();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [okCount, setOkCount] = useState(0);
  const [selected, setSelected] = useState(0);

  function upload(formEl: HTMLFormElement) {
    const files = Array.from(inputRef.current?.files ?? []);
    const alt = String(new FormData(formEl).get("alt") ?? "");
    if (files.length === 0) {
      setErrors(["Yüklenecek görselleri seçin."]);
      return;
    }
    setErrors([]);
    setOkCount(0);
    startTransition(async () => {
      const problems: string[] = [];
      let ok = 0;
      setProgress({ done: 0, total: files.length });
      for (const [i, file] of files.entries()) {
        if (file.size > MAX_BYTES) {
          problems.push(`${file.name}: görsel en fazla 10 MB olabilir.`);
        } else {
          const fd = new FormData();
          fd.set("colorId", colorId);
          fd.set("alt", alt);
          fd.set("file", file);
          try {
            const r = await action(fd);
            if (r.ok) ok++;
            else problems.push(`${file.name}: ${r.error}`);
          } catch {
            problems.push(`${file.name}: yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.`);
          }
        }
        setProgress({ done: i + 1, total: files.length });
      }
      setErrors(problems);
      setOkCount(ok);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
      setSelected(0);
      router.refresh();
    });
  }

  return (
    <form
      className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        upload(e.currentTarget);
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-col">
          <label htmlFor={`${id}-dosya`} className="label text-graphite">
            Görsel ekle — {colorName}
          </label>
          <input
            ref={inputRef}
            id={`${id}-dosya`}
            type="file"
            name="file"
            accept={ACCEPT}
            multiple
            disabled={pending}
            onChange={(e) => setSelected(e.currentTarget.files?.length ?? 0)}
            aria-describedby={`${id}-ipucu`}
            className="mt-1 min-h-11 max-w-full text-[0.8125rem] file:mr-3 file:text-[0.75rem] file:uppercase file:tracking-[0.06em] file:min-h-11 file:cursor-pointer file:border file:border-ink file:bg-paper file:px-4 file:text-ink hover:file:bg-fog"
          />
          <p id={`${id}-ipucu`} className="mt-1.5 text-[0.75rem] text-graphite">
            JPEG, PNG, WebP ya da AVIF; en az 300×300 piksel, en fazla 10 MB. iPhone fotoğraflarını JPEG olarak dışa aktarın. Dikey (4:5) görseller vitrinde en iyi görünür.
          </p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <label htmlFor={`${id}-alt`} className="label text-graphite">
            Alt metin (isteğe bağlı)
          </label>
          <input
            id={`${id}-alt`}
            name="alt"
            maxLength={200}
            disabled={pending}
            placeholder={`ör. ${colorName} deri sneaker, yandan`}
            className="min-h-11 border-0 border-b border-ash bg-transparent px-0 py-2 outline-none placeholder:text-ash focus:border-ink focus:shadow-[0_1px_0_0_var(--color-ink)]"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={pending || selected === 0}
        className="label inline-flex min-h-12 items-center justify-center bg-ink px-6 text-paper hover:bg-night disabled:cursor-not-allowed disabled:bg-ash"
      >
        {pending && progress
          ? `Yükleniyor ${progress.done}/${progress.total}`
          : selected > 1
            ? `${selected} görseli yükle`
            : "Görseli yükle"}
      </button>
      <div className="sm:basis-full" aria-live="polite">
        {okCount > 0 && !pending && (
          <p role="status" className="text-[0.8125rem] text-graphite">
            {okCount} görsel yüklendi.
          </p>
        )}
        {errors.map((m) => (
          <InlineError key={m} message={m} />
        ))}
      </div>
    </form>
  );
}
