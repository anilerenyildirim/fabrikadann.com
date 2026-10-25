import { beforeEach, expect, test } from "vitest";
import {
  addressSchema,
  createAddress,
  deleteAddress,
  getAddress,
  listAddresses,
  normalizePhone,
  updateAddress,
} from "@/server/services/addresses";
import { makeUser, resetDb } from "../helpers/db";

beforeEach(resetDb);

const input = { title: "Ev", fullName: "Ayşe Yılmaz", phone: "05551112233", city: "İstanbul", district: "Kadıköy", line: "Moda Cd. No 1 D 2" };

test("telefon numarası biçimlenir", () => {
  expect(normalizePhone("0555 111 22 33")).toBe("05551112233");
  expect(normalizePhone("+90 (555) 111-22-33")).toBe("05551112233");
  expect(normalizePhone("5551112233")).toBe("05551112233");
  expect(normalizePhone("12345")).toBeNull();
  expect(normalizePhone("05551112233; DROP")).toBeNull();
});

test("geçersiz il reddedilir", () => {
  expect(addressSchema.safeParse({ ...input, city: "Gotham" }).success).toBe(false);
  expect(addressSchema.safeParse(input).success).toBe(true);
});

test("adresler yalnızca sahibine görünür ve değiştirilebilir", async () => {
  const a = await makeUser();
  const b = await makeUser();
  const created = await createAddress(a.id, input);
  if (!created.ok) throw new Error(created.error);
  expect(await getAddress(b.id, created.id)).toBeNull();
  expect(await updateAddress(b.id, created.id, { ...input, title: "Ele geçirildi" })).toBe(false);
  expect(await deleteAddress(b.id, created.id)).toBe(false);
  expect((await listAddresses(a.id))[0]!.title).toBe("Ev");
  expect(await getAddress(a.id, "gecersiz-id")).toBeNull();
  expect(await deleteAddress(a.id, created.id)).toBe(true);
});
