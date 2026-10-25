"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parsePriceToKurus } from "@/lib/money";
import type { FormState } from "@/lib/form";
import { rateLimit } from "@/server/auth/rate-limit";
import { MAX_UPLOAD_BYTES } from "@/server/storage/images";
import {
  addColor,
  addProductImage,
  addVariants,
  createProduct,
  deleteColor,
  deleteImage,
  deleteVariant,
  moveColor,
  moveImage,
  renameColor,
  setProductStatus,
  updateImageAlt,
  updateProduct,
  updateVariant,
} from "@/server/services/admin/catalog";
import { adminContext, errorState, GENERIC_ERROR, parseForm } from "../../_lib/action";

const uuid = z.uuid("Kayıt bulunamadı. Sayfayı yenileyin.");
const direction = z.enum(["up", "down"]);
const productStatus = z.enum(["draft", "active", "archived"]);

/** Vitrin ve panel aynı veriyi gösterir; katalog değişince hepsi yeniden çizilsin. */
function refreshCatalog() {
  revalidatePath("/", "layout");
}

const tl = (message: string) =>
  z
    .string()
    .trim()
    .transform((s, ctx) => {
      const k = parsePriceToKurus(s);
      if (!s || Number.isNaN(k)) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return k;
    });

const productForm = z.object({
  name: z.string().max(300).default(""),
  slug: z.string().max(300).default(""),
  description: z.string().max(10000).default(""),
  details: z.string().max(10000).default(""),
  categoryId: z
    .string()
    .default("")
    .transform((v) => v || null),
  price: tl("Fiyatı 1.299,90 biçiminde yazın."),
  trendyolPrice: z
    .string()
    .trim()
    .default("")
    .transform((s, ctx) => {
      if (!s) return null;
      const k = parsePriceToKurus(s);
      if (Number.isNaN(k)) {
        ctx.addIssue({ code: "custom", message: "Trendyol fiyatını 1.499,90 biçiminde yazın ya da boş bırakın." });
        return z.NEVER;
      }
      return k;
    }),
  status: z.enum(["draft", "active", "archived"], { error: "Durum seçin." }).default("draft"),
  featured: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

export async function createProductAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(productForm, form);
  if (!parsed.ok) return parsed.state;
  let id: string;
  try {
    ({ id } = await createProduct({ ...parsed.data, status: "draft" }, ctx));
  } catch (e) {
    return errorState(e, parsed.values, "urun-olustur");
  }
  refreshCatalog();
  redirect(`/yonetim/urunler/${id}?yeni=1`);
}

export async function updateProductAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const productId = uuid.safeParse(form.get("productId"));
  if (!productId.success) return { error: "Ürün bulunamadı. Sayfayı yenileyin." };
  const parsed = parseForm(productForm, form);
  if (!parsed.ok) return parsed.state;
  const statusShown = productStatus.safeParse(form.get("statusShown"));
  try {
    await updateProduct(productId.data, parsed.data, ctx, { statusShown: statusShown.success ? statusShown.data : undefined });
  } catch (e) {
    return errorState(e, parsed.values, "urun-guncelle");
  }
  refreshCatalog();
  return { ok: true, message: "Ürün bilgileri kaydedildi." };
}

const STATUS_MESSAGES = {
  active: "Ürün yayına alındı; vitrinde görünüyor.",
  draft: "Ürün taslağa alındı; vitrinde görünmüyor.",
  archived: "Ürün arşivlendi; vitrinde görünmüyor, sipariş geçmişi korunuyor.",
} as const;

export async function setProductStatusAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ productId: uuid, status: productStatus }), form);
  if (!parsed.ok) return { error: "Geçersiz istek. Sayfayı yenileyin." };
  try {
    await setProductStatus(parsed.data.productId, parsed.data.status, ctx);
  } catch (e) {
    return errorState(e, undefined, "urun-durum");
  }
  refreshCatalog();
  return { ok: true, message: STATUS_MESSAGES[parsed.data.status] };
}

// ---------- Renkler ----------

export async function addColorAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ productId: uuid, name: z.string().max(200).default("") }), form);
  if (!parsed.ok) return parsed.state;
  try {
    await addColor(parsed.data.productId, parsed.data.name, ctx);
  } catch (e) {
    return errorState(e, parsed.values, "renk-ekle");
  }
  refreshCatalog();
  return { ok: true, message: `"${parsed.data.name.trim()}" rengi eklendi. Şimdi görsel yükleyip numara ekleyin.` };
}

export async function renameColorAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ colorId: uuid, name: z.string().max(200).default("") }), form);
  if (!parsed.ok) return parsed.state;
  try {
    await renameColor(parsed.data.colorId, parsed.data.name, ctx);
  } catch (e) {
    return errorState(e, parsed.values, "renk-adi");
  }
  refreshCatalog();
  return { ok: true, message: "Renk adı kaydedildi." };
}

export async function moveColorAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ colorId: uuid, direction }), form);
  if (!parsed.ok) return { error: "Geçersiz istek. Sayfayı yenileyin." };
  try {
    await moveColor(parsed.data.colorId, parsed.data.direction, ctx);
  } catch (e) {
    return errorState(e, undefined, "renk-sira");
  }
  refreshCatalog();
  return {};
}

export async function deleteColorAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ colorId: uuid }), form);
  if (!parsed.ok) return { error: "Geçersiz istek. Sayfayı yenileyin." };
  try {
    await deleteColor(parsed.data.colorId, ctx);
  } catch (e) {
    return errorState(e, undefined, "renk-sil");
  }
  refreshCatalog();
  return { ok: true, message: "Renk silindi." };
}

// ---------- Görseller ----------

export type UploadResult = { ok: true } | { ok: false; error: string };

/**
 * Tek görsel yükler (istemci birden çok dosyayı sırayla gönderir; her istek gövde sınırının altında kalır).
 * Dosya sunucuda yeniden doğrulanır ve sharp ile yeniden kodlanır.
 */
export async function uploadImageAction(form: FormData): Promise<UploadResult> {
  const ctx = await adminContext();
  const parsed = z
    .object({ colorId: uuid, alt: z.string().max(200, "Alt metin en fazla 200 karakter olabilir.").default("") })
    .safeParse({ colorId: form.get("colorId"), alt: form.get("alt") ?? "" });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz istek." };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Yüklenecek bir görsel seçin." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Görsel en fazla 10 MB olabilir." };

  try {
    // Görsel işleme pahalı: hesap başına saatte 300 yükleme
    const limited = await rateLimit(`yonetim-gorsel:${ctx.actorId}`, 300, 3600);
    if (!limited.ok) return { ok: false, error: "Çok fazla görsel yüklendi. Bir süre sonra yeniden deneyin." };
    const buffer = Buffer.from(await file.arrayBuffer());
    await addProductImage(parsed.data.colorId, buffer, parsed.data.alt, ctx);
  } catch (e) {
    const state = errorState(e, undefined, "gorsel-yukle");
    return { ok: false, error: state.error ?? Object.values(state.fieldErrors ?? {})[0] ?? GENERIC_ERROR };
  }
  refreshCatalog();
  return { ok: true };
}

export async function updateImageAltAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ imageId: uuid, alt: z.string().max(400).default("") }), form);
  if (!parsed.ok) return parsed.state;
  try {
    await updateImageAlt(parsed.data.imageId, parsed.data.alt, ctx);
  } catch (e) {
    return errorState(e, parsed.values, "gorsel-alt");
  }
  refreshCatalog();
  return { ok: true, message: "Kaydedildi." };
}

export async function moveImageAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ imageId: uuid, direction }), form);
  if (!parsed.ok) return { error: "Geçersiz istek. Sayfayı yenileyin." };
  try {
    await moveImage(parsed.data.imageId, parsed.data.direction, ctx);
  } catch (e) {
    return errorState(e, undefined, "gorsel-sira");
  }
  refreshCatalog();
  return {};
}

export async function deleteImageAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ imageId: uuid }), form);
  if (!parsed.ok) return { error: "Geçersiz istek. Sayfayı yenileyin." };
  try {
    await deleteImage(parsed.data.imageId, ctx);
  } catch (e) {
    return errorState(e, undefined, "gorsel-sil");
  }
  refreshCatalog();
  return { ok: true, message: "Görsel silindi." };
}

// ---------- Numaralar ----------

export async function addVariantsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(
    z.object({
      colorId: uuid,
      sizes: z.string().max(400, "Numara girişi çok uzun.").default(""),
      stock: z
        .string()
        .trim()
        .default("0")
        .transform((s) => (s === "" ? 0 : Number(s))),
    }),
    form,
  );
  if (!parsed.ok) return parsed.state;
  let result: { added: string[]; skipped: string[] };
  try {
    result = await addVariants(parsed.data.colorId, parsed.data.sizes, parsed.data.stock, ctx);
  } catch (e) {
    return errorState(e, parsed.values, "numara-ekle");
  }
  refreshCatalog();
  const parts: string[] = [];
  if (result.added.length) parts.push(`Eklendi: ${result.added.join(", ")}.`);
  if (result.skipped.length) parts.push(`Zaten vardı: ${result.skipped.join(", ")}.`);
  return { ok: true, message: parts.join(" ") };
}

export async function updateVariantAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(
    // Alan adı "barkod": ortak safeValues "code" içeren alanları geri doldurmuyor
    z.object({ variantId: uuid, sku: z.string().max(200).default(""), barkod: z.string().max(200).default("") }),
    form,
  );
  if (!parsed.ok) return parsed.state;
  try {
    await updateVariant(parsed.data.variantId, { sku: parsed.data.sku, barcode: parsed.data.barkod }, ctx);
  } catch (e) {
    return errorState(e, parsed.values, "numara-guncelle");
  }
  refreshCatalog();
  return { ok: true, message: "Kaydedildi." };
}

export async function deleteVariantAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ variantId: uuid }), form);
  if (!parsed.ok) return { error: "Geçersiz istek. Sayfayı yenileyin." };
  try {
    await deleteVariant(parsed.data.variantId, ctx);
  } catch (e) {
    return errorState(e, undefined, "numara-sil");
  }
  refreshCatalog();
  return { ok: true, message: "Numara silindi." };
}
