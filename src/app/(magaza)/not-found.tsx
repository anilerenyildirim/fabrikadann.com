import type { Metadata } from "next";
import { StatusView } from "@/components/home/StatusView";
import { ButtonLink } from "@/components/ui/form";

export const metadata: Metadata = { title: "Sayfa bulunamadı" };

export default function StoreNotFound() {
  return (
    <StatusView
      eyebrow="404"
      title="Bu sayfa bulunamadı"
      actions={
        <>
          <ButtonLink href="/urunler">Ürünlere göz at</ButtonLink>
          <ButtonLink href="/" variant="secondary">
            Ana sayfaya dön
          </ButtonLink>
        </>
      }
    >
      <p>Ürün satıştan kalkmış ya da adres değişmiş olabilir. Aradığınızı ürünler arasında ya da aramayla bulabilirsiniz.</p>
    </StatusView>
  );
}
