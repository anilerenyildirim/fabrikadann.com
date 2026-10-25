import type { Metadata } from "next";
import { AccountHeader } from "@/components/account/AccountHeader";
import { OrderList } from "@/components/account/OrderList";
import { ButtonLink } from "@/components/ui/form";
import { requireAccountUser } from "@/components/account/guard";
import { listOrdersForUser } from "@/server/services/orders";

export const metadata: Metadata = { title: "Siparişlerim" };

export default async function OrdersPage() {
  const user = await requireAccountUser("/hesabim/siparisler");
  const orders = await listOrdersForUser(user.id);

  return (
    <>
      <AccountHeader title="Siparişlerim" back />
      {orders.length === 0 ? (
        <div className="border-t border-rule pt-10">
          <p className="wide text-[0.8125rem]">Henüz siparişiniz yok</p>
          <p className="mt-3 max-w-md text-graphite">
            Verdiğiniz siparişler, durumları ve kargo takip bilgileriyle burada görünür.
          </p>
          <ButtonLink href="/urunler" className="mt-8 w-full sm:w-auto">
            Ürünlere göz atın
          </ButtonLink>
        </div>
      ) : (
        <OrderList orders={orders} />
      )}
    </>
  );
}
