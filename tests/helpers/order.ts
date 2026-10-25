import { addToCart, type CartOwner } from "@/server/services/cart";
import { createOrder } from "@/server/services/orders";

export const address = { fullName: "Ayşe Yılmaz", phone: "05551112233", city: "İstanbul", district: "Kadıköy", line: "Moda Cd. 1" };

export async function orderFor(owner: CartOwner, variantId: string, qty = 1, userId: string | null = null) {
  const added = await addToCart(owner, variantId, qty);
  if (!added.ok) throw new Error(added.error);
  return createOrder(owner, { email: "ayse@ornek.com", userId, address, ip: "1.2.3.4" });
}
