# Üretici, üretim barkodu, alış fiyatı ve muhasebe — tasarım (30.10.2026)

Kaynak: toplantı notları (kullanıcı, 30.10.2026). Gereksinimleri işleyişe göre ben tamamladım; açık sorular en altta.

## Gereksinimler

1. **Üretim barkodu (yalnızca yönetim):** ürüne numara eklenince her numaraya otomatik, benzersiz bir EAN-13 barkodu verilir
   (`29` ile başlar — mağaza içi kullanım aralığı, GS1 ürün koduyla çakışmaz). Mevcut numaralara da geriye dönük atanır.
   Trendyol barkodundan ayrıdır (Trendyol eşleşmesi değişmez). Panelde ürün sayfasında görünür, yazdırılabilir etiket sayfası vardır.
2. **Üreticiler:** ad, yetkili, telefon, e-posta, vergi dairesi/no, adres, IBAN, not, açılış (devir) bakiyesi, etkin/pasif.
   Ürün eklenirken üretici seçilir (yeni üründe zorunlu; eski ürünlerde sonradan seçilir).
3. **Alış fiyatı (yalnızca yönetim):** ürün başına, kuruş. Vitrine hiçbir yoldan sızmaması için üretici ve alış fiyatı ayrı
   tabloda (`product_supply`) tutulur; satış anındaki maliyet de ayrı tabloda (`order_item_costs`). Müşteri sorguları bu tablolara hiç dokunmaz.
4. **Mal alımı (alış fişi):** üretici seçilir, o üreticinin ürünleri numara numara adetle girilir (barkod okuyucuyla da),
   birim maliyet alış fiyatından gelir, değiştirilebilir. Kaydedilince stok artar (hareket nedeni `purchase`) ve üreticiye borç yazılır.
   **Üreticiye iade** fişi stoğu düşer, borcu azaltır. Fişler silinmez; yanlışlık ters fişle düzeltilir (denetim izi).
5. **Gelir–gider kayıtları:** tarih, tür (gelir/gider), kategori, tutar, ödeme şekli, açıklama. "Üretici ödemesi" kategorisinde
   üretici seçilir ve borçtan düşer. Trendyol hakedişi gelir kategorisi olarak girilir (Trendyol API'si fiyat vermediği için).
6. **Cari hesap (üretici ekstresi):** devir + alımlar − iadeler − ödemeler = bakiye (pozitif: biz borçluyuz). Tarih sıralı, yürüyen bakiyeli.
   Ayrıca **satışa göre ödenecek**: o üreticinin satılan ürünlerinin maliyeti − yapılan ödemeler (satıldıkça ödeme modeli için).
   Ürün bazında: alınan, iade edilen, satılan (site + Trendyol), stokta kalan adet ve tutarları.
7. **Muhasebe özeti (dönemsel, aylık):** site satış geliri (ödenmiş ve iade/iptal edilmemiş siparişler, ödeme tarihine göre),
   kargo geliri dahil; satılan malın maliyeti; brüt kâr; diğer gelirler; giderler (kategoriye göre, üretici ödemeleri hariç — o borç kapamadır);
   net sonuç; toplam üretici borcu; stoğun alış değeri. Maliyeti girilmemiş satılan ürünler uyarı olarak gösterilir.

## Kapsam dışı (sonraki adım)
- e-Fatura / e-Arşiv (sağlayıcı bekleniyor), KDV ayrıştırması, çek/senet, müşteri carisi, Excel dışa aktarma.

## Açık sorular (kullanıcıya)
- Üretici borcu teslimatta mı doğuyor (fiş), yoksa yalnızca satıldıkça mı (konsinye)? İkisi de gösteriliyor.
- Üretim barkodu Trendyol barkodu olarak da kullanılacak mı? Şu an ayrı tutuluyor.
- Gelir-gider kategorileri listesi onayı.
