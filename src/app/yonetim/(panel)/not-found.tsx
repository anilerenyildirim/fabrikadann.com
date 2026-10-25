import Link from "next/link";

export default function AdminNotFound() {
  return (
    <div className="max-w-lg py-10">
      <p className="label text-graphite">404</p>
      <h1 className="wide mt-2 text-lg">Kayıt bulunamadı</h1>
      <p className="mt-4 text-[0.8125rem] text-graphite">
        Aradığınız ürün, sipariş ya da sayfa yok; silinmiş ya da adres yanlış yazılmış olabilir.
      </p>
      <div className="mt-8 flex flex-wrap gap-4">
        <Link href="/yonetim" className="label inline-flex min-h-11 items-center bg-ink px-6 text-paper hover:bg-night">
          Panoya dön
        </Link>
        <Link href="/yonetim/siparisler" className="label inline-flex min-h-11 items-center border border-ink px-6 hover:bg-fog">
          Siparişler
        </Link>
      </div>
    </div>
  );
}
