import { describe, expect, test } from "vitest";
import { randomToken } from "@/server/auth/crypto";
import { generateOrderNumber } from "@/server/services/orders";
import {
  addGuestOrder,
  MAX_GUEST_ORDERS,
  parseGuestOrders,
  serializeGuestOrders,
  type GuestOrderRef,
} from "@/server/guest-orders";

const ref = (): GuestOrderRef => ({ number: generateOrderNumber(), token: randomToken() });

describe("misafir sipariş çerezi", () => {
  test("serileştirilen liste aynen geri okunur", () => {
    const list = [ref(), ref(), ref()];
    expect(parseGuestOrders(serializeGuestOrders(list))).toEqual(list);
  });

  test("boş, eksik ya da tür dışı değer boş liste döner", () => {
    for (const raw of [undefined, null, "", 42, {}, ["FDABCDEFGH.x"]]) {
      expect(parseGuestOrders(raw)).toEqual([]);
    }
  });

  test("bozuk ya da uydurma içerik boş liste döner", () => {
    const token = randomToken();
    for (const raw of [
      "çöp",
      "FDABCDEFGH",
      `FDABCDEFGH.${token.slice(1)}`, // kısa token
      `FDABCDEFGH.${token}x`, // uzun token
      `FDabcdefgh.${token}`, // küçük harf numara
      `FD1BCDEFGH.${token}`, // 1 alfabede yok
      `XXABCDEFGH.${token}`,
      `FDABCDEFGH.${token.slice(0, 42)}!`, // izin verilmeyen karakter
      `FDABCDEFGH:${token}`,
      `{"number":"FDABCDEFGH","token":"${token}"}`,
      `FDABCDEFGH.${token}<script>`,
      `../FDABCDEFGH.${token}`,
      "~~~~",
    ]) {
      expect(parseGuestOrders(raw), raw).toEqual([]);
    }
  });

  test("geçersiz kayıtlar atlanır, geçerliler korunur", () => {
    const good = ref();
    expect(parseGuestOrders(`çöp~${good.number}.${good.token}~FDXX.y`)).toEqual([good]);
  });

  test("çok uzun çerez tümüyle reddedilir", () => {
    const good = ref();
    const raw = `${good.number}.${good.token}~${"a".repeat(500)}`;
    expect(parseGuestOrders(raw)).toEqual([]);
  });

  test("aynı numara bir kez okunur; en fazla 5 kayıt", () => {
    const a = ref();
    const twice = `${a.number}.${a.token}~${a.number}.${randomToken()}`;
    expect(parseGuestOrders(twice)).toEqual([a]);

    const many = Array.from({ length: 7 }, ref);
    // Serileştirme de 5 ile sınırlar; ayrıştırmayı ayrıca elle yazılmış uzun bir içerikle dene
    const raw = many.slice(0, 7).map((r) => `${r.number}.${r.token}`).join("~");
    expect(raw.length).toBeLessThanOrEqual(400);
    expect(parseGuestOrders(raw)).toEqual(many.slice(0, MAX_GUEST_ORDERS));
    expect(parseGuestOrders(serializeGuestOrders(many))).toHaveLength(MAX_GUEST_ORDERS);
  });

  test("yeni sipariş başa eklenir, en eski düşer, aynı numara yenilenir", () => {
    let list: GuestOrderRef[] = [];
    const refs = Array.from({ length: 6 }, ref);
    for (const r of refs) list = addGuestOrder(list, r);
    expect(list).toEqual([...refs].reverse().slice(0, MAX_GUEST_ORDERS));

    const renewed = { number: refs[3]!.number, token: randomToken() };
    list = addGuestOrder(list, renewed);
    expect(list[0]).toEqual(renewed);
    expect(list.filter((r) => r.number === renewed.number)).toHaveLength(1);
    expect(list).toHaveLength(MAX_GUEST_ORDERS);
  });

  test("geçersiz kayıt eklenmez ve yazılmaz", () => {
    const good = ref();
    expect(addGuestOrder([good], { number: "FD123", token: "x" })).toEqual([good]);
    expect(serializeGuestOrders([good, { number: "<b>", token: "~" }])).toBe(`${good.number}.${good.token}`);
  });
});
