import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { audit } from "../audit";
import { AdminError, assertAdmin, type AdminContext } from "./context";

/** AI Asistan önerisinden yöneticinin seçtiği alanlar (verilmeyen alan değişmez). */
export const applyInputSchema = z.object({
  name: z.string().trim().min(1, "Ürün adı boş olamaz.").max(120, "Ürün adı en fazla 120 karakter olabilir.").optional(),
  description: z.string().trim().max(5000, "Açıklama en fazla 5000 karakter olabilir.").optional(),
  details: z.string().trim().max(5000, "Malzeme ve bakım en fazla 5000 karakter olabilir.").optional(),
  categoryId: z.uuid("Kategori bulunamadı.").optional(),
  colors: z.array(z.object({ colorId: z.uuid(), name: z.string().trim().min(1).max(40) })).max(30).optional(),
  n11Attributes: z
    .array(z.object({ id: z.number().int().positive(), name: z.string().max(80), valueId: z.number().int().positive().nullable(), customValue: z.string().trim().max(255).nullable() }))
    .max(40)
    .optional(),
});
export type ApplyInput = z.input<typeof applyInputSchema>;

export async function applySuggestion(ctx: AdminContext, productId: string, raw: ApplyInput): Promise<void> {
  await assertAdmin(ctx);
  const input = applyInputSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, productId)).for("update");
    if (!product) throw new AdminError("Ürün bulunamadı.");
    if (input.categoryId) {
      const [c] = await tx.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.id, input.categoryId));
      if (!c) throw new AdminError("Önerilen kategori artık yok. Kategoriyi elle seçin.");
    }
    if (input.colors?.length) {
      const own = await tx.select().from(schema.productColors).where(eq(schema.productColors.productId, productId));
      const renames = new Map(input.colors.map((c) => [c.colorId, c.name]));
      if ([...renames.keys()].some((id) => !own.some((c) => c.id === id))) throw new AdminError("Renk bu ürüne ait değil. Sayfayı yenileyin.");
      const finalNames = own.map((c) => (renames.get(c.id) ?? c.name).toLocaleLowerCase("tr"));
      if (new Set(finalNames).size !== finalNames.length) throw new AdminError("İki renge aynı ad verilemez. Renk adlarından birini değiştirin.");
      for (const [id, name] of renames) {
        await tx.update(schema.productColors).set({ name }).where(and(eq(schema.productColors.id, id), eq(schema.productColors.productId, productId)));
      }
    }
    const marketplaceAttrs = input.n11Attributes ? { ...product.marketplaceAttrs, n11: input.n11Attributes } : product.marketplaceAttrs;
    await tx
      .update(schema.products)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.details !== undefined ? { details: input.details } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        marketplaceAttrs,
      })
      .where(eq(schema.products.id, productId));
    await audit(
      {
        action: "ai.suggestion_applied",
        actorId: ctx.actorId,
        ip: ctx.ip ?? null,
        target: productId,
        data: { fields: Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined) },
      },
      tx,
    );
  });
}
