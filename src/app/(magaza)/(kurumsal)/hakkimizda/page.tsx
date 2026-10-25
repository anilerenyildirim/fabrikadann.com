import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { ButtonLink } from "@/components/ui/form";

export const metadata: Metadata = {
  title: "Hakkımızda",
  description: "fabrikadann: ayakkabılar üreticiden doğrudan size, aracısız.",
  alternates: { canonical: "/hakkimizda" },
};

export default function AboutPage() {
  return (
    <LegalPage title="Hakkımızda" updated={false}>
      <p className="text-[1.0625rem] leading-relaxed">
        fabrikadann, ayakkabıyı üretildiği yerden doğrudan size ulaştırmak için kuruldu. Adımız da buradan geliyor:
        fabrikadan, aracısız.
      </p>
      <p>
        Üretici ile sizin aranızdaki her aracı fiyata bir pay ekler. Biz ayakkabılarımızı üreticiden doğrudan size
        gönderiyoruz. Bu sitede pazar yeri komisyonu da olmadığı için aynı ayakkabıları diğer satış kanallarımızdan
        daha uygun fiyatla sunabiliyoruz.
      </p>
      <p>
        Koleksiyonumuzu sade tutuyoruz: her gün giyilecek, kolay eşleşen modeller. Bir sorunuz olursa ya da numara
        konusunda kararsız kalırsanız bize yazın.
      </p>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/urunler" className="w-full sm:w-auto">
          Ürünlere göz atın
        </ButtonLink>
        <ButtonLink href="/iletisim" variant="secondary" className="w-full sm:w-auto">
          Bize ulaşın
        </ButtonLink>
      </div>
    </LegalPage>
  );
}
