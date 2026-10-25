import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";

/** Üretilen genişlikler; vitrin srcset'i bunlardan seçer. */
export const IMAGE_WIDTHS = [400, 800, 1200, 1600] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 8000 * 8000;
// HEIC: sharp'ın hazır paketleri HEVC çözemiyor; kabul edilmez
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "avif"]);

// Anahtar biçimi: "p/<uuid>" — dosya yolu buradan türetilir, dışarıdan gelen yol kullanılmaz
const KEY_RE = /^p\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_RE = /^p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(400|800|1200|1600)\.webp$/;

export class ImageError extends Error {}

function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR || "./uploads");
}

function fileFor(id: string, width: number): string {
  return path.join(uploadRoot(), "p", `${id}-${width}.webp`);
}

export type StoredImage = { key: string; width: number; height: number };

/**
 * Yüklenen görseli doğrular ve yeniden kodlar: yalnızca gerçek görsel dosyaları kabul edilir,
 * EXIF/konum gibi meta veriler atılır, her boyut WebP olarak yazılır.
 */
export async function storeProductImage(input: Buffer): Promise<StoredImage> {
  if (input.byteLength === 0) throw new ImageError("Dosya boş.");
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new ImageError("Görsel en fazla 10 MB olabilir.");

  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ImageError("Dosya bir görsel değil ya da bozuk.");
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw new ImageError("Yalnızca JPEG, PNG, WebP ya da AVIF yüklenebilir. iPhone fotoğraflarını JPEG olarak dışa aktarın.");
  }
  if (!meta.width || !meta.height || meta.width < 300 || meta.height < 300) {
    throw new ImageError("Görsel en az 300×300 piksel olmalı.");
  }
  // EXIF yönü 5–8 ise görsel 90° döndürülecek: genişlik/yükseklik yer değiştirir
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;

  const id = randomUUID();
  await mkdir(path.join(uploadRoot(), "p"), { recursive: true });
  try {
    for (const w of IMAGE_WIDTHS) {
      // Her boyut doğrudan özgün dosyadan üretilir (ara yeniden kodlama yok); rotate() yönü
      // EXIF'e göre düzeltir, çıktıya meta veri (konum vb.) yazılmaz
      const out = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: Math.min(w, width), withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      await writeFile(fileFor(id, w), out);
    }
  } catch (e) {
    await deleteProductImage(`p/${id}`);
    console.error("Görsel işlenemedi", e);
    throw new ImageError("Görsel işlenemedi. Dosya bozuk olabilir; başka bir dosya deneyin.");
  }
  return { key: `p/${id}`, width, height };
}

export async function deleteProductImage(key: string): Promise<void> {
  if (!KEY_RE.test(key)) return;
  const id = key.slice(2);
  await Promise.all(IMAGE_WIDTHS.map((w) => rm(fileFor(id, w), { force: true })));
}

/** "/medya/p/<uuid>-800.webp" isteği için dosya; biçim tutmazsa null. */
export async function readMediaFile(relative: string): Promise<Buffer | null> {
  const m = FILE_RE.exec(relative);
  if (!m) return null;
  try {
    return await readFile(fileFor(m[1]!, Number(m[2])));
  } catch {
    return null;
  }
}

export function mediaUrl(key: string, width: ImageWidth): string {
  return `/medya/${key}-${width}.webp`;
}

export function mediaSrcSet(key: string, originalWidth: number): string {
  return IMAGE_WIDTHS.filter((w, i) => i === 0 || w <= originalWidth * 1.2)
    .map((w) => `${mediaUrl(key, w)} ${Math.min(w, originalWidth)}w`)
    .join(", ");
}
