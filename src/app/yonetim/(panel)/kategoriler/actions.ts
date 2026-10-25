"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/form";
import { createCategory, deleteCategory, moveCategory, updateCategory } from "@/server/services/admin/catalog";
import { adminContext, errorState, parseForm } from "../../_lib/action";

const uuid = z.uuid("Kategori bulunamadı. Sayfayı yenileyin.");
const fields = { name: z.string().max(200).default(""), slug: z.string().max(200).default("") };

export async function createCategoryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object(fields), form);
  if (!parsed.ok) return parsed.state;
  try {
    const { slug } = await createCategory(parsed.data, ctx);
    revalidatePath("/", "layout");
    return { ok: true, message: `"${parsed.data.name.trim()}" eklendi (/kategori/${slug}).` };
  } catch (e) {
    return errorState(e, parsed.values, "kategori-ekle");
  }
}

export async function updateCategoryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ categoryId: uuid, ...fields }), form);
  if (!parsed.ok) return parsed.state;
  try {
    await updateCategory(parsed.data.categoryId, { name: parsed.data.name, slug: parsed.data.slug }, ctx);
  } catch (e) {
    return errorState(e, parsed.values, "kategori-guncelle");
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Kaydedildi." };
}

export async function deleteCategoryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ categoryId: uuid }), form);
  if (!parsed.ok) return { error: "Geçersiz istek. Sayfayı yenileyin." };
  try {
    await deleteCategory(parsed.data.categoryId, ctx);
  } catch (e) {
    return errorState(e, undefined, "kategori-sil");
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Kategori silindi." };
}

export async function moveCategoryAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const parsed = parseForm(z.object({ categoryId: uuid, direction: z.enum(["up", "down"]) }), form);
  if (!parsed.ok) return { error: "Geçersiz istek. Sayfayı yenileyin." };
  try {
    await moveCategory(parsed.data.categoryId, parsed.data.direction, ctx);
  } catch (e) {
    return errorState(e, undefined, "kategori-sira");
  }
  revalidatePath("/", "layout");
  return {};
}
