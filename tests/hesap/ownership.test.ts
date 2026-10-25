import { beforeEach, expect, test } from "vitest";
import { idSchema } from "@/components/account/schemas";
import {
  createAddress,
  deleteAddress,
  getAddress,
  listAddresses,
  savedAddressSchema,
  updateAddress,
} from "@/server/services/addresses";
import { getOrderForUser, listOrdersForUser } from "@/server/services/orders";
import { makeProduct, makeUser, resetDb } from "../helpers/db";
import { orderFor } from "../helpers/order";

beforeEach(resetDb);

const address = savedAddressSchema.parse({
  title: "Ev",
  fullName: "Ayşe Yılmaz",
  phone: "0555 111 22 33",
  city: "İstanbul",
  district: "Kadıköy",
  line: "Moda Cd. No 1 Daire 2",
});

test("Hesabım › Adreslerim: başkasının adresi görülemez, değiştirilemez, silinemez", async () => {
  const ayse = await makeUser();
  const mehmet = await makeUser();
  const created = await createAddress(ayse.id, address);
  if (!created.ok) throw new Error(created.error);

  expect(await getAddress(mehmet.id, created.id)).toBeNull();
  expect(await updateAddress(mehmet.id, created.id, { ...address, title: "Ele geçirildi" })).toBe(false);
  expect(await deleteAddress(mehmet.id, created.id)).toBe(false);
  expect(await listAddresses(mehmet.id)).toEqual([]);

  const still = await getAddress(ayse.id, created.id);
  expect(still?.title).toBe("Ev");
});

test("adres kimliği UUID değilse sorgu yapılmadan reddedilir", async () => {
  const ayse = await makeUser();
  for (const bad of ["1", "' OR 1=1 --", "../x", ""]) {
    expect(idSchema.safeParse(bad).success).toBe(false);
    expect(await getAddress(ayse.id, bad)).toBeNull();
  }
});

test("Hesabım › Siparişlerim: yalnızca kendi siparişleri listelenir, başkasının numarası bulunamaz", async () => {
  const ayse = await makeUser();
  const mehmet = await makeUser();
  const { variants } = await makeProduct({ sizes: [{ size: "40", stock: 5 }] });
  const order = await orderFor({ userId: ayse.id }, variants[0]!.id, 1, ayse.id);

  const mine = await listOrdersForUser(ayse.id);
  expect(mine.map((o) => o.number)).toEqual([order.number]);
  expect(mine[0]!.items).toHaveLength(1);

  expect(await listOrdersForUser(mehmet.id)).toEqual([]);
  expect(await getOrderForUser(mehmet.id, order.number)).toBeNull();
});
