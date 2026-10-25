import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand/Logo";
import { StatusView } from "@/components/home/StatusView";
import { ButtonLink } from "@/components/ui/form";

export const metadata: Metadata = { title: "Sayfa bulunamadı" };

/** Hiçbir sayfayla eşleşmeyen adresler (mağaza düzeni dışında, kök düzende gösterilir). */
export default function NotFound() {
  return (
    <>
      <header className="flex h-14 items-center px-3 md:h-16 md:px-6">
        <Link href="/" className="flex min-h-11 items-center px-1" aria-label="fabrikadann ana sayfa">
          <Wordmark className="h-[13px] w-auto md:h-[17px]" />
        </Link>
      </header>
      <main id="icerik">
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
          <p>Adres yanlış yazılmış ya da sayfa kaldırılmış olabilir.</p>
        </StatusView>
      </main>
    </>
  );
}
