"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrorsOf, formToObject, type FormState } from "@/lib/form";
import type { AddressSnapshot } from "@/server/db/schema";
import { getClientIp, getClientIpForRecord, getCurrentUser } from "@/server/auth/current";
import { rateLimit } from "@/server/auth/rate-limit";
import { getCartOwner } from "@/server/cart-owner";
import { listOpenAccessibleOrders, rememberGuestOrder } from "@/server/guest-orders";
import { emailSchema } from "@/server/services/accounts";
import { addressSchema, createAddress, getAddress, toSnapshot } from "@/server/services/addresses";
import { getCart } from "@/server/services/cart";
import { createOrder, OrderError, type CreatedOrder } from "@/server/services/orders";
import { PaymentError, startPayment } from "@/server/services/payments";
import { appUrl, cartSignature, paymentRedirectTarget } from "./_lib/payment";

export type CheckoutState = FormState & {
  /** Sorunlu ürünler (stok bitti vb.) */
  details?: string[];
  /** Hata sepette düzeltilmeli */
  backToCart?: boolean;
  /** Ödemesi bekleyen, bu tarayıcının/hesabın erişebildiği siparişler (açık sipariş sınırı aşıldığında) */
  openOrders?: string[];
};

const NEW_ADDRESS = "new";

// Hata sonrası forma geri yollanan alanlar; başka hiçbir girdi yansıtılmaz
const ECHO_FIELDS = ["email", "fullName", "phone", "city", "district", "line", "addressId", "saveAddress", "title", "terms"];

const checkoutSchema = z.object({
  terms: z.literal("on", "Siparişi vermek için ön bilgilendirme formunu ve mesafeli satış sözleşmesini onaylayın."),
  addressId: z
    .union([z.literal(NEW_ADDRESS), z.uuid("Bir teslimat adresi seçin.")], "Bir teslimat adresi seçin.")
    .default(NEW_ADDRESS),
  saveAddress: z.literal("on").optional(),
  title: z.string().trim().max(40, "Adres adı en fazla 40 karakter olabilir.").optional(),
  cartSig: z.string().max(64).default(""),
});

/**
 * Sepetten sipariş oluşturur ve ödeme sayfasına yönlendirir. Tutarlar yalnızca sunucuda,
 * sepetteki güncel fiyatlardan hesaplanır; formdan fiyat ya da tutar alınmaz.
 */
export async function placeOrder(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const input = formToObject(form);
  const values = Object.fromEntries(
    ECHO_FIELDS.filter((k) => typeof input[k] === "string").map((k) => [k, input[k]!.slice(0, 400)]),
  );
  const user = await getCurrentUser();

  const fieldErrors: Record<string, string> = {};
  const base = checkoutSchema.safeParse(input);
  if (!base.success) Object.assign(fieldErrors, fieldErrorsOf(base.error));

  let email: string | null = user?.email ?? null;
  if (!user) {
    const parsed = emailSchema.safeParse(input.email ?? "");
    if (parsed.success) email = parsed.data;
    else fieldErrors.email = "Geçerli bir e-posta adresi girin.";
  }

  let address: AddressSnapshot | null = null;
  const addressId = base.success ? base.data.addressId : NEW_ADDRESS;
  if (user && addressId !== NEW_ADDRESS) {
    // Kayıtlı adres yalnızca sahibine döner
    const saved = await getAddress(user.id, addressId);
    if (saved) address = toSnapshot(saved);
    else fieldErrors.addressId = "Seçtiğiniz adres bulunamadı. Başka bir adres seçin ya da yeni adres girin.";
  } else if (!fieldErrors.addressId) {
    const parsed = addressSchema.safeParse(input);
    if (parsed.success) address = toSnapshot(parsed.data);
    else Object.assign(fieldErrors, fieldErrorsOf(parsed.error));
  }

  if (Object.keys(fieldErrors).length > 0 || !email || !address || !base.success) {
    return { error: "Bazı bilgiler eksik ya da hatalı. İşaretli alanları düzeltin.", fieldErrors, values };
  }

  const ip = await getClientIp();
  const limit = await rateLimit(`odeme:${ip}`, 10, 600);
  if (!limit.ok) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfter / 60));
    return { error: `Kısa sürede çok sayıda sipariş denemesi yapıldı. ${minutes} dakika sonra tekrar deneyin.`, values };
  }

  const owner = await getCartOwner();
  if (!owner) return { error: "Sepetiniz boş. Ürün ekleyip tekrar deneyin.", backToCart: true };

  // Müşteri sayfada gördüğü tutarı onayladı; bu arada sepet ya da fiyat değiştiyse yeni özeti göstermeden sipariş verilmez
  const cart = await getCart(owner);
  if (cart.lines.length === 0) return { error: "Sepetiniz boş. Ürün ekleyip tekrar deneyin.", backToCart: true };
  if (base.data.cartSig !== cartSignature(cart)) {
    revalidatePath("/odeme");
    return {
      error: "Siz bu sayfadayken sepetiniz ya da fiyatlar değişti. Güncel sipariş özetini kontrol edip siparişi yeniden onaylayın.",
      values,
    };
  }

  let order: CreatedOrder;
  try {
    order = await createOrder(owner, { email, userId: user?.id ?? null, address, ip: await getClientIpForRecord() });
  } catch (e) {
    if (e instanceof OrderError) {
      if (e.code === "too_many_open_orders") {
        const openOrders = await listOpenAccessibleOrders().catch(() => []);
        return { error: e.message, openOrders, values };
      }
      return { error: e.message, details: e.details, backToCart: true, values };
    }
    console.error("Sipariş oluşturulamadı", e);
    return { error: "Siparişiniz oluşturulamadı. Birkaç dakika sonra tekrar deneyin.", values };
  }

  if (user && addressId === NEW_ADDRESS && base.data.saveAddress) {
    // Adres kaydedilemezse (ör. sınır dolu) sipariş yine de devam eder
    const title = base.data.title || "Teslimat adresi";
    await createAddress(user.id, { ...address, title }).catch((e) => console.error("Adres kaydedilemedi", e));
  }
  if (order.guestAccessToken) await rememberGuestOrder(order.number, order.guestAccessToken);
  revalidatePath("/", "layout");

  const orderPage = `/siparis/${order.number}`;
  let target: string;
  try {
    const { redirectUrl } = await startPayment(order.id, { appUrl: appUrl(), ip });
    target = paymentRedirectTarget(redirectUrl, orderPage);
  } catch (e) {
    if (!(e instanceof PaymentError)) console.error("Ödeme başlatılamadı", e);
    // Sipariş oluştu ve stok ayrıldı: müşteri sipariş sayfasından ödemeyi yeniden deneyebilir
    target = `${orderPage}?odeme=baslatilamadi`;
  }
  redirect(target);
}
