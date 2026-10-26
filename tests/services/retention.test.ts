import { beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { transitionOrder } from "@/server/services/orders";
import { completePayment, startPayment } from "@/server/services/payments";
import { applyRetention } from "@/server/services/retention";
import { makeProduct, makeUser, resetDb } from "../helpers/db";
import { orderFor } from "../helpers/order";

beforeEach(resetDb);

const DAY = 24 * 60 * 60 * 1000;

test("ödenmemiş iptal siparişler 30 gün sonra anonimleşir, ödenmişlere dokunulmaz", async () => {
  const admin = await makeUser({ role: "admin" });
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }] });
  const unpaid = await orderFor({ guestToken: "a" }, variants[0]!.id);
  await transitionOrder(unpaid.id, "cancelled", admin.id);
  const paid = await orderFor({ guestToken: "b" }, variants[0]!.id);
  const token = (await startPayment(paid.id, { appUrl: "http://x", ip: "1.1.1.1" })).redirectUrl.split("/").at(-1)!;
  await completePayment({ token, success: true, amount: paid.total });
  await transitionOrder(paid.id, "cancelled", admin.id);

  // Henüz 30 gün geçmedi
  expect((await applyRetention()).anonymizedOrders).toBe(0);

  const later = new Date(Date.now() + 31 * DAY);
  expect((await applyRetention(later)).anonymizedOrders).toBe(1);
  expect((await applyRetention(later)).anonymizedOrders).toBe(0);

  const [u] = await db.select().from(schema.orders).where(eq(schema.orders.id, unpaid.id));
  expect(u!.email).toMatch(/@silindi\.invalid$/);
  expect(u!.shippingAddress.fullName).toBe("Silindi");
  expect(u!.termsAcceptedIp).toBeNull();
  expect(u!.guestAccessHash).toBeNull();
  const [p] = await db.select().from(schema.orders).where(eq(schema.orders.id, paid.id));
  expect(p!.email).toBe("ayse@ornek.com");
});

test("eski güvenlik kayıtlarındaki IP ve kullanılmış sıfırlama bağlantıları silinir", async () => {
  const user = await makeUser();
  await db.insert(schema.auditLog).values({ action: "x", ip: "1.2.3.4" });
  await db.insert(schema.passwordResetTokens).values([
    { idHash: "kullanildi", userId: user.id, expiresAt: new Date(Date.now() + DAY), usedAt: new Date() },
    { idHash: "gecerli", userId: user.id, expiresAt: new Date(Date.now() + DAY) },
  ]);
  const result = await applyRetention(new Date(Date.now() + 366 * DAY));
  expect(result.auditIps).toBe(1);
  expect(result.resetTokens).toBe(2);
  expect((await db.select().from(schema.auditLog))[0]!.ip).toBeNull();
});

test("7 günde doğrulanmayan ve siparişi olmayan üyelik silinir; doğrulanmış olana dokunulmaz", async () => {
  const { registerCustomer } = await import("@/server/services/accounts");
  const r = await registerCustomer({ email: "dogrulanmadi@ornek.com", password: "Kuvvetli-Parola-42", firstName: "A", lastName: "B" });
  if (!r.ok || !r.value.created) throw new Error("kayıt");
  const verified = await makeUser();
  expect((await applyRetention()).unverifiedAccounts).toBe(0);
  const result = await applyRetention(new Date(Date.now() + 8 * DAY));
  expect(result.unverifiedAccounts).toBe(1);
  const left = await db.select().from(schema.users);
  expect(left.map((u) => u.id)).toEqual([verified.id]);
});
