import { beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => {}) }));

import { db, schema } from "@/server/db";
import { sendMail } from "@/server/mail";
import { audit } from "@/server/services/audit";
import { AdminAccessError, AdminError, type AdminContext } from "@/server/services/admin/context";
import { getDashboard, listRefundsNeeded, resolveRefund } from "@/server/services/admin/dashboard";
import { changeOrderStatus, getAdminOrder, listAdminOrders } from "@/server/services/admin/orders";
import { listCustomers } from "@/server/services/admin/customers";
import { listStockRows } from "@/server/services/admin/stock";
import { listAuditEntries } from "@/server/services/admin/audit-log";
import { makeProduct, makeUser, resetDb } from "../helpers/db";
import { orderFor } from "../helpers/order";

let ctx: AdminContext;

beforeEach(async () => {
  await resetDb();
  vi.mocked(sendMail).mockClear();
  const admin = await makeUser({ role: "admin" });
  ctx = { actorId: admin.id, ip: "10.0.0.2" };
});

const stockOf = async (id: string) =>
  (await db.select().from(schema.variants).where(eq(schema.variants.id, id)))[0]!.stock;

async function paidOrder(stock = 3, qty = 1, userId: string | null = null) {
  const { variants } = await makeProduct({ price: 150000, sizes: [{ size: "40", stock }] });
  const owner = userId ? { userId } : { guestToken: `g-${Math.random()}` };
  const order = await orderFor(owner, variants[0]!.id, qty, userId);
  await db.update(schema.orders).set({ status: "preparing", paidAt: new Date() }).where(eq(schema.orders.id, order.id));
  return { order, variantId: variants[0]!.id };
}

describe("kargoya verme", () => {
  test("firma ve takip no zorunlu; müşteriye e-posta gider, işlem günlüğe yazılır", async () => {
    const { order } = await paidOrder();
    await expect(changeOrderStatus(order.id, { to: "shipped" }, ctx)).rejects.toMatchObject({ field: "carrier" });
    await expect(
      changeOrderStatus(order.id, { to: "shipped", carrier: "Aras Kargo", trackingNumber: "" }, ctx),
    ).rejects.toMatchObject({ field: "trackingNumber" });
    await expect(
      changeOrderStatus(order.id, { to: "shipped", carrier: "Uydurma Kargo" as never, trackingNumber: "123456" }, ctx),
    ).rejects.toBeInstanceOf(AdminError);
    expect(sendMail).not.toHaveBeenCalled();

    const result = await changeOrderStatus(
      order.id,
      { to: "shipped", carrier: "Yurtiçi Kargo", trackingNumber: "YK-123456789" },
      ctx,
    );
    expect(result).toEqual({ mailSent: true });

    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(row).toMatchObject({ status: "shipped", carrier: "Yurtiçi Kargo", trackingNumber: "YK-123456789" });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendMail).mock.calls[0]![0];
    expect(mail.to).toBe("ayse@ornek.com");
    expect(mail.subject).toContain(order.number);
    expect(mail.text).toContain("Yurtiçi Kargo");
    expect(mail.text).toContain("YK-123456789");

    const logs = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "order.status"));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorId: ctx.actorId,
      target: order.number,
      ip: "10.0.0.2",
      data: { from: "preparing", to: "shipped", carrier: "Yurtiçi Kargo", trackingNumber: "YK-123456789" },
    });
  });

  test("'Diğer' seçilirse firma adı yazılmalı ve o ad kaydedilir", async () => {
    const { order } = await paidOrder();
    await expect(
      changeOrderStatus(order.id, { to: "shipped", carrier: "Diğer", trackingNumber: "ABC123" }, ctx),
    ).rejects.toMatchObject({ field: "carrierOther" });
    await changeOrderStatus(order.id, { to: "shipped", carrier: "Diğer", carrierOther: "Kolay Gelsin", trackingNumber: "ABC123" }, ctx);
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(row!.carrier).toBe("Kolay Gelsin");
  });

  test("e-posta gönderilemese de durum değişir ve sonuç bildirilir", async () => {
    const { order } = await paidOrder();
    vi.mocked(sendMail).mockRejectedValueOnce(new Error("SMTP kapalı"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await changeOrderStatus(order.id, { to: "shipped", carrier: "PTT Kargo", trackingNumber: "PTT0001" }, ctx);
    spy.mockRestore();
    expect(result).toEqual({ mailSent: false });
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(row!.status).toBe("shipped");
  });
});

describe("iptal ve iade", () => {
  test("iade: 'stoğa geri ekle' seçilmezse stok değişmez, seçilirse geri gelir", async () => {
    const a = await paidOrder(3, 2);
    expect(await stockOf(a.variantId)).toBe(1);
    await changeOrderStatus(a.order.id, { to: "shipped", carrier: "UPS", trackingNumber: "1Z999" }, ctx);
    await changeOrderStatus(a.order.id, { to: "refunded", restock: false }, ctx);
    expect(await stockOf(a.variantId)).toBe(1);

    const b = await paidOrder(3, 2);
    await changeOrderStatus(b.order.id, { to: "shipped", carrier: "UPS", trackingNumber: "1Z998" }, ctx);
    await changeOrderStatus(b.order.id, { to: "delivered" }, ctx);
    await changeOrderStatus(b.order.id, { to: "refunded", restock: true }, ctx);
    expect(await stockOf(b.variantId)).toBe(3);
  });

  test("hazırlanan sipariş iptal edilince stok geri gelir; izinsiz geçiş reddedilir", async () => {
    const { order, variantId } = await paidOrder(2, 1);
    await expect(changeOrderStatus(order.id, { to: "delivered" }, ctx)).rejects.toBeInstanceOf(AdminError);
    await changeOrderStatus(order.id, { to: "cancelled" }, ctx);
    expect(await stockOf(variantId)).toBe(2);
    await expect(changeOrderStatus(order.id, { to: "preparing" }, ctx)).rejects.toBeInstanceOf(AdminError);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("ekrandaki durum eskiyse geçiş reddedilir; ödenmiş sipariş iptali iade listesine düşer", async () => {
    const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 3 }] });
    const order = await orderFor({ guestToken: "eski" }, variants[0]!.id, 1);
    // Yönetici "ödeme bekleniyor" görürken ödeme geldi
    await db.update(schema.orders).set({ status: "preparing", paidAt: new Date() }).where(eq(schema.orders.id, order.id));
    await expect(
      changeOrderStatus(order.id, { to: "cancelled", expectedFrom: "awaiting_payment" }, ctx),
    ).rejects.toThrow(/bu arada/);
    await changeOrderStatus(order.id, { to: "cancelled", expectedFrom: "preparing" }, ctx);
    const refunds = await listRefundsNeeded();
    expect(refunds.map((r) => [r.orderNumber, r.reason])).toEqual([[order.number, "Ödenmiş sipariş iptal edildi"]]);
  });

  test("yönetici olmayan sipariş durumunu değiştiremez", async () => {
    const customer = await makeUser();
    const { order } = await paidOrder();
    await expect(
      changeOrderStatus(order.id, { to: "cancelled" }, { actorId: customer.id }),
    ).rejects.toBeInstanceOf(AdminAccessError);
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(row!.status).toBe("preparing");
    await expect(changeOrderStatus("1 or 1=1", { to: "cancelled" }, ctx)).rejects.toBeInstanceOf(AdminError);
  });
});

describe("listeler ve pano", () => {
  test("sipariş listesi durum, numara ve e-posta ile süzülür; detay hassas alan içermez", async () => {
    const { order } = await paidOrder();
    const { variants } = await makeProduct();
    await orderFor({ guestToken: "bekleyen" }, variants[0]!.id, 1);
    expect((await listAdminOrders()).total).toBe(2);
    expect((await listAdminOrders({ status: "preparing" })).items.map((o) => o.id)).toEqual([order.id]);
    expect((await listAdminOrders({ status: "preparing" })).items[0]).toMatchObject({ itemCount: 1, isGuest: true });
    expect((await listAdminOrders({ q: order.number.toLowerCase() })).items).toHaveLength(1);
    expect((await listAdminOrders({ q: "AYSE@ORNEK" })).total).toBe(2);
    expect((await listAdminOrders({ q: "%" })).total).toBe(0);
    const detail = (await getAdminOrder(order.id))!;
    expect(detail.items).toHaveLength(1);
    expect(detail).not.toHaveProperty("guestAccessHash");
    expect(detail.allowed).toEqual(["shipped", "cancelled"]);
    expect(await getAdminOrder("yok")).toBeNull();
  });

  test("pano: kargolanacak, ödeme bekleyen, bugünkü ciro, düşük stok, iade gereken", async () => {
    const { order } = await paidOrder(3, 2); // 2 × 1.500 TL, stok 1 kalır
    const { variants } = await makeProduct({ sizes: [{ size: "41", stock: 10 }] });
    await orderFor({ guestToken: "x" }, variants[0]!.id, 1);
    await audit({ action: "payment.needs_refund", target: order.number, data: { paymentId: "p" } });

    const d = await getDashboard();
    expect(d.toShip).toBe(1);
    expect(d.awaitingPayment).toBe(1);
    expect(d.today.count).toBe(1);
    expect(d.today.total).toBe(300000 + (await getAdminOrder(order.id))!.shippingFee);
    expect(d.week).toHaveLength(7);
    expect(d.weekTotal).toBe(d.today.total);
    expect(d.lowStock.map((l) => l.stock)).toEqual([1]);
    expect(d.recent).toHaveLength(2);
    expect(d.refunds).toHaveLength(1);
    expect(d.refunds[0]!.orderId).toBe(order.id);

    await resolveRefund(d.refunds[0]!.auditId, ctx);
    await resolveRefund(d.refunds[0]!.auditId, ctx); // ikinci kez: değişiklik yok
    expect(await listRefundsNeeded()).toHaveLength(0);
    const resolved = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "payment.refund_resolved"));
    expect(resolved).toHaveLength(1);
  });

  test("dün ödenen sipariş bugünkü ciroya girmez, iptal edilen hiç girmez", async () => {
    const a = await paidOrder();
    await db
      .update(schema.orders)
      .set({ paidAt: new Date(Date.now() - 26 * 60 * 60 * 1000) })
      .where(eq(schema.orders.id, a.order.id));
    const b = await paidOrder();
    await changeOrderStatus(b.order.id, { to: "cancelled" }, ctx);
    const d = await getDashboard();
    expect(d.today.total).toBe(0);
    expect(d.weekCount).toBe(1);
  });

  test("müşteri listesi: sipariş sayısı ve toplam harcama; stok filtresi; günlük", async () => {
    const user = await makeUser({ email: "musteri@ornek.com" });
    await paidOrder(5, 1, user.id);
    await makeUser({ email: "baska@ornek.com" });
    const { items } = await listCustomers({ q: "musteri" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ email: "musteri@ornek.com", orderCount: 1 });
    expect(items[0]!.totalSpent).toBe(150000); // 1.500 TL, ücretsiz kargo eşiğinde
    // Yöneticiler müşteri listesinde görünmez
    expect((await listCustomers()).items.map((c) => c.email).sort()).toEqual(["baska@ornek.com", "musteri@ornek.com"]);

    await makeProduct({ sizes: [{ size: "38", stock: 0 }, { size: "39", stock: 2 }, { size: "40", stock: 9 }] });
    expect((await listStockRows({ filter: "out" })).map((r) => r.size)).toEqual(["38"]);
    expect((await listStockRows({ filter: "low" })).map((r) => r.size)).toEqual(["39"]);
    expect(await listStockRows({ filter: "all" })).toHaveLength(4);

    await audit({ action: "product.create", actorId: ctx.actorId, target: "x", ip: "1.1.1.1" });
    const log = await listAuditEntries();
    expect(log.items[0]).toMatchObject({ action: "product.create", ip: "1.1.1.1" });
    expect(log.items[0]!.actorEmail).toMatch(/@ornek\.com$/);
    expect((await listAuditEntries({ group: "order" })).total).toBe(0);
  });
});
