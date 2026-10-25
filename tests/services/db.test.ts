import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { makeProduct, resetDb } from "../helpers/db";

beforeEach(resetDb);

test("stok negatife düşemez", async () => {
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 1 }] });
  await expect(
    db.update(schema.variants).set({ stock: -1 }).where(eq(schema.variants.id, variants[0]!.id)),
  ).rejects.toThrow();
});
