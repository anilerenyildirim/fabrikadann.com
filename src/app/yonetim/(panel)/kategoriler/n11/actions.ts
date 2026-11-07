"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/form";
import { requireAdmin } from "@/server/auth/current";
import { rateLimit } from "@/server/auth/rate-limit";
import type { N11Attribute } from "@/server/marketplaces/n11/client";
import { n11ClientOrError } from "@/server/marketplaces/n11";
import { deleteCategoryMapping, getMappingAttributes, refreshN11Categories, saveCategoryMapping, searchN11Categories } from "@/server/services/admin/n11";
import { adminContext, errorState } from "../../../_lib/action";

const PATH = "/yonetim/kategoriler/n11";

export async function refreshN11CategoriesAction(_prev: FormState, _form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const c = n11ClientOrError();
  if ("error" in c) return { error: c.error };
  try {
    const n = await refreshN11Categories(ctx, c.client);
    revalidatePath(PATH);
    return { ok: true, message: `${n.toLocaleString("tr-TR")} N11 kategorisi alındı.` };
  } catch (e) {
    return errorState(e, undefined, "n11-kategori");
  }
}

export async function searchN11CategoriesAction(q: unknown): Promise<{ externalId: number; path: string }[]> {
  await requireAdmin();
  const parsed = z.string().max(100).safeParse(q);
  if (!parsed.success) return [];
  return searchN11Categories(parsed.data);
}

export async function n11AttributesAction(externalId: unknown): Promise<{ attributes?: N11Attribute[]; error?: string }> {
  const ctx = await adminContext();
  const id = z.number().int().positive().safeParse(externalId);
  if (!id.success) return { error: "N11 kategorisini listeden seçin." };
  const limited = await rateLimit(`n11-ozellik:${ctx.actorId}`, 300, 3600);
  if (!limited.ok) return { error: "Çok sık denendi. Biraz sonra yeniden deneyin." };
  const c = n11ClientOrError();
  if ("error" in c) return { error: c.error };
  try {
    return { attributes: await getMappingAttributes(ctx, c.client, id.data) };
  } catch (e) {
    return { error: errorState(e, undefined, "n11-ozellik").error ?? "Özellikler okunamadı." };
  }
}

export async function saveN11MappingAction(raw: unknown): Promise<{ ok?: true; error?: string }> {
  const ctx = await adminContext();
  const c = n11ClientOrError();
  if ("error" in c) return { error: c.error };
  try {
    await saveCategoryMapping(ctx, c.client, raw as Parameters<typeof saveCategoryMapping>[2]);
  } catch (e) {
    if (e instanceof z.ZodError) return { error: "Eşleştirme bilgisi geçersiz. Sayfayı yenileyip yeniden deneyin." };
    return { error: errorState(e, undefined, "n11-esle").error ?? "Eşleştirme kaydedilemedi." };
  }
  revalidatePath(PATH);
  revalidatePath("/yonetim/urunler/n11");
  return { ok: true };
}

export async function deleteN11MappingAction(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminContext();
  const id = z.uuid().safeParse(form.get("categoryId"));
  if (!id.success) return { error: "Kategori bulunamadı. Sayfayı yenileyin." };
  await deleteCategoryMapping(ctx, id.data);
  revalidatePath(PATH);
  return { ok: true, message: "Eşleştirme kaldırıldı." };
}
