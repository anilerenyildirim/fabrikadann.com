# Canlıya alma ve işletme

Bu belge fabrikadann.com'un bir sunucuda (VPS) çalıştırılmasını anlatır. Uygulama Docker imajı
olarak çalışır; önünde Caddy (otomatik HTTPS) ve yanında PostgreSQL bulunur.

## 1. Sunucu

- Ubuntu 24.04 LTS, Docker + Docker Compose eklentisi.
- Güvenlik duvarı: yalnızca 22, 80, 443 açık (`ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`).
- SSH yalnızca anahtarla; parola girişi kapalı.
- 2 GB swap.
- Önerilen konum Türkiye ya da AB (hız ve KVKK yurt dışı aktarım yükümlülükleri açısından).

## 2. İmajı derleme

İmajı sunucuda değil, kendi bilgisayarınızda ya da CI'da derleyin (`next build` çok bellek ister).
Derlemeyi yalnızca Docker içinde yapın: `.env` bulunan bir klasörde `next build` çalıştırıp
`.next/standalone`'u elle sunucuya kopyalamayın (Next `.env`'i pakete dahil eder). Temel imaj sürümleri
(`Dockerfile`'daki Node, compose'daki Postgres ve Caddy) sabittir; güvenlik güncellemelerini takip edip
etiketleri bilinçli olarak yükseltin.

```bash
docker build -t fabrikadann:latest .
docker save fabrikadann:latest | gzip > fabrikadann.tar.gz
scp fabrikadann.tar.gz sunucu:~
# sunucuda:
gunzip -c fabrikadann.tar.gz | docker load
```

## 3. Ortam değişkenleri (`.env.production`, sunucuda proje kökünde)

```env
NODE_ENV=production
APP_URL=https://fabrikadann.com
POSTGRES_PASSWORD=<uzun rastgele; yalnızca harf, rakam, - ve _ (URL'ye gömülür)>
APP_DB_PASSWORD=<ayrı, uzun rastgele; yalnızca harf, rakam, - ve _; uygulamanın kısıtlı veritabanı rolü için>
SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))">
PAYMENT_PROVIDER=mock          # iyzico entegrasyonu eklenince: iyzico
CLIENT_IP_HEADER=x-real-ip     # her zaman bu; Cloudflare için deploy/Caddyfile'daki trusted_proxies bloğunu açın
SMTP_URL=smtps://kullanici:parola@smtp.saglayici.com:465
MAIL_FROM="fabrikadann <siparis@fabrikadann.com>"
# Trendyol ortak stok (isteğe bağlı; bkz. §5c)
TRENDYOL_SELLER_ID=
TRENDYOL_API_KEY=
TRENDYOL_API_SECRET=
TRENDYOL_ENV=prod
```

Notlar:
- `SESSION_SECRET` aynı zamanda yönetici TOTP anahtarlarını şifreler. Değiştirirseniz her yönetici için
  `scripts/create-admin.ts <e-posta> <ad> <soyad> --reset-totp` ile yeni anahtar kurun.
- Kısıtlı veritabanı rolü (`deploy/db-init`) yalnızca veri klasörü boşken, ilk kurulumda oluşturulur.
- Uygulama yalnızca Caddy arkasında çalıştırılmalı: istemci IP'si Caddy'nin yazdığı `X-Real-IP`'den okunur.

`PAYMENT_PROVIDER=mock` canlıda yalnızca yönetici oturumuyla çalışır (müşteriler sahte ödemeyle
sipariş tamamlayamaz). Gerçek satışa iyzico entegrasyonu eklenmeden başlanmamalıdır.

## 4. İlk kurulum

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production up -d db
# Migration sahip rolle çalışır; parola yalnızca bu komuta verilir, uygulama konteynerinde durmaz
set -a; . ./.env.production; set +a
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production run --rm -e MIGRATION_DATABASE_URL="postgres://fabrikadann:${POSTGRES_PASSWORD}@db:5432/fabrikadann" app npx tsx scripts/migrate.ts
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production up -d
# Yönetici hesabı (parola ve iki adımlı doğrulama anahtarı bir kez ekrana yazılır)
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production run --rm app npx tsx scripts/create-admin.ts siz@fabrikadann.com Ad Soyad
```

Ekrana yazılan `otpauth://` adresini ya da base32 anahtarı Google Authenticator / 1Password gibi
bir uygulamaya ekleyin. Yönetim paneli: `https://fabrikadann.com/yonetim`.

Sonra panelden **Ayarlar**'a girip şirket unvanı, adres, vergi dairesi/no, MERSİS, KEP, telefon ve
e-posta bilgilerini doldurun — yasal sayfalar (mesafeli satış, ön bilgilendirme, KVKK) bu bilgileri
kullanır.

## 5. Zamanlanmış bakım

Ödeme süresi (30 dk) dolan siparişlerin stoğu her yeni siparişte ve panel açılışında da serbest
bırakılır; yine de düzenli çalıştırın:

```cron
*/5 * * * * cd /srv/fabrikadann && docker compose -f deploy/docker-compose.prod.yml --env-file .env.production run --rm app npx tsx scripts/maintenance.ts >> /var/log/fabrikadann-bakim.log 2>&1
```

## 5b. KVKK silme talebi

Müşteri hesabını kapatıp kişisel verilerini silmek için (siparişler yasal süre boyunca saklanır):

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production run --rm app npx tsx scripts/delete-customer.ts musteri@ornek.com           # önizleme
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production run --rm app npx tsx scripts/delete-customer.ts musteri@ornek.com --onayla
```

## 5c. Trendyol ortak stok

Site ve Trendyol aynı depodan satar. Stoğun kaynağı sitedir (panel → Stok):

- Trendyol'da oluşan sipariş, numaranın stoğundan düşülür (eşleşme **barkodla**: panelde her numaranın
  barkodu Trendyol'daki barkodla aynı olmalı). İptal edilen / tedarik edilemeyen paketlerin adedi geri konur.
- Barkodu olan her numaranın satılabilir stoğu değiştiğinde Trendyol'a gönderilir (fiyat gönderilmez;
  Trendyol fiyatını Trendyol panelinden yönetin). Numara silinir ya da barkodu değişirse eski barkoda 0 gönderilir.
- Ürün sayfasındaki "Trendyol'da X TL" karşılaştırması saatte bir Trendyol'daki satış fiyatından güncellenir
  (ürünün satıştaki barkodlarının en düşüğü; her değişiklik işlem günlüğüne yazılır). Trendyol fiyatı sitedekinden
  yüksek değilse ya da ürünün hiçbir barkodu Trendyol'da satışta değilse karşılaştırma kaldırılır (ilkinde
  panelde uyarı çıkar). Barkodu olmayan üründe elle girilen değer kalır.
- Trendyol iadeleri (Returned) stoğa otomatik dönmez: ürün kontrol edildikten sonra panelden elle ekleyin.
- Depo sayımında Trendyol'da henüz kargolanmamış siparişler de "ayrılmış" sayılır.

Kurulum:

1. Satıcı panelinde Hesap Bilgilerim → Entegrasyon Bilgileri'nden Satıcı ID, API Key ve API Secret'ı alıp
   `.env.production`'a yazın (bkz. §3), uygulamayı yeniden başlatın.
2. **Açmadan önce** panelde her numaranın barkodunu girin ve sitedeki stoğu doğru yapın: satılabilir stok =
   depodaki adet − iki kanalda henüz kargolanmamış siparişler. Senkronun ilk çalıştığı andan önce verilmiş Trendyol
   siparişleri stok değiştirmeden "zaten düşülmüş" kabul edilir (son 13 günde değişmiş olanlar sonradan iptal
   edilirse adet stoğa döner; daha eskiler için iptal stoğa elle eklenir);
   ilk çalıştırma sitedeki stoğu Trendyol'a gönderir (Trendyol'daki stok
   sitedekiyle değişir). Emin değilseniz ilk çalıştırmadan sonra Stok sayfasında "Depo sayımı" ile sayılan
   adedi girin; iki kanalın kargolanmamış siparişleri otomatik düşülür.
3. Zamanlanmış görev (2 dakikada bir; iki kanalda aynı çiftin satılma penceresi bu süre kadardır):

```cron
*/2 * * * * cd /srv/fabrikadann && docker compose -f deploy/docker-compose.prod.yml --env-file .env.production run --rm app npx tsx scripts/trendyol-sync.ts >> /var/log/fabrikadann-trendyol.log 2>&1
```

Panelde Stok sayfasının altındaki "Trendyol senkronu" bölümü (ve sorun varsa Pano) şunları gösterir:
son çalıştırma ve hata, stok yetmeyen Trendyol siparişleri (aynı çift iki kanalda satıldıysa: birini iptal
edin ya da stok ekleyin; stok gelince eksik adet kendiliğinden düşülür), hiçbir numarayla eşleşmeyen
barkodlar ve Trendyol'un reddettiği stok gönderimleri (16 dakika sonra yeniden denenir; aynı adet reddedildikçe
aralık uzar). Trendyol'da satılmayan ürünlerin numaralarına barkod girmeyin.

Depo sayımı ("Depo sayımı" türüyle tek tek ya da toplu) o numaranın Trendyol kayıtlarını da kapatır: Trendyol'da
kargolanmamış adetler sayımdan düşülür, kargolanmış ama henüz düşülmemiş siparişler sayıma göre düşülmüş kabul edilir.

Önce test ortamında deneyin: `TRENDYOL_ENV=stage` ve test hesabı bilgileri (test ortamı için sunucunun
çıkış IP'si Trendyol çağrı merkezine tanıtılmalı). Denenecekler §8'de.

## 6. Yedekleme (zorunlu)

Sipariş verisi en kritik varlıktır. Her gece veritabanı ve görseller yedeklenmeli. Komut önce geçici
dosyaya yazar; yedek boşsa ya da komut başarısızsa günlüğe "BAŞARISIZ" yazar (sessizce boş yedek oluşmaz):

```cron
30 3 * * * C="docker compose -f /srv/fabrikadann/deploy/docker-compose.prod.yml --env-file /srv/fabrikadann/.env.production"; F=/yedek/db-$(date +\%F).dump; $C exec -T db pg_dump -U fabrikadann -Fc fabrikadann > $F.tmp 2>>/var/log/fabrikadann-yedek.log && test -s $F.tmp && mv $F.tmp $F || echo "$(date) DB YEDEGI BASARISIZ" >> /var/log/fabrikadann-yedek.log
45 3 * * * F=/yedek/gorseller-$(date +\%F).tgz; docker run --rm -v deploy_uploads:/u:ro -v /yedek:/b alpine tar czf /b/$(basename $F).tmp -C /u . 2>>/var/log/fabrikadann-yedek.log && mv $F.tmp $F || echo "$(date) GORSEL YEDEGI BASARISIZ" >> /var/log/fabrikadann-yedek.log
```

(`deploy_uploads` adı compose proje adından gelir; `docker volume ls` ile doğrulayın.)

Yedekler müşterilerin kişisel verisini içerir:

- Yedek klasörü yalnızca root'a açık olsun: `sudo install -d -m 700 /yedek` ve cron satırlarının başına `umask 077;` ekleyin.
- 14 günden eski yedekleri silin: `0 5 * * * find /yedek -type f -mtime +14 -delete`
- Sunucu dışına **şifreli** kopyalayın, ör. [age](https://age-encryption.org) ile: `age -r <açık-anahtar> -o db.dump.age db.dump`
  (özel anahtar sunucuda durmasın). Geri yüklemeyi en az bir kez deneyin.
- Bakım ve yedek günlükleri için logrotate tanımlayın (ör. haftalık, 4 kopya).

## 7. Güncelleme

Trendyol senkronunu getiren güncellemeden (migration 0004) önce, aynı barkodun iki numarada olmadığını kontrol edin;
varsa migration benzersizlik kuralında durur:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production exec db psql -U fabrikadann fabrikadann -c "select barcode, count(*) from variants where barcode is not null group by barcode having count(*) > 1"
```


Yeni imajı yükleyin, migration'ları çalıştırın, uygulamayı yeniden başlatın:

```bash
docker compose ... run --rm -e MIGRATION_DATABASE_URL="postgres://fabrikadann:${POSTGRES_PASSWORD}@db:5432/fabrikadann" app npx tsx scripts/migrate.ts
docker compose ... up -d app
```

## 8. Canlıya çıkmadan önce yapılacaklar

- [ ] iyzico üye işyeri anlaşması → `.env.production`'a `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL=https://api.iyzipay.com` ve `PAYMENT_PROVIDER=iyzico`. Adaptör (`src/server/payments/iyzico.ts`) ve dönüş adresi (`/api/odeme/iyzico`) hazır; önce sandbox anahtarlarıyla uçtan uca deneyin. Bakım betiği (5 dk) sonucu tarayıcıyla dönmeyen ödemeleri iyzico'ya sorar.
- [ ] Yasal metinlerin (mesafeli satış, ön bilgilendirme, KVKK, çerez, iade) avukat kontrolü; iade kargo koşulunun belirlenmesi.
- [ ] Ayarlar'dan şirket bilgileri.
- [ ] Gerçek ürün fotoğrafları (4:5 dikey oran, en az 1600 px genişlik önerilir).
- [ ] SMTP — **zorunlu**: üyelik e-posta doğrulamasıyla açılıyor; SMTP yoksa yeni müşteriler hesaplarını etkinleştiremez (misafir alışveriş çalışır). Sipariş, kargo ve parola e-postaları da buradan gider. SPF/DKIM/DMARC kayıtlarını ekleyin.
- [ ] Alan adı DNS'i sunucuya: yalnızca A kaydı (Docker IPv6 kurulmadan AAAA yayımlamayın). Cloudflare kullanılacaksa proxy açık + `deploy/Caddyfile`'daki `trusted_proxies` bloğu açık; `CLIENT_IP_HEADER=x-real-ip` kalır.
- [ ] Yedeklemenin çalıştığının doğrulanması.
- [ ] e-Fatura/e-Arşiv entegrasyonu (muhasebe sürecinize göre).
- [ ] Trendyol kullanılacaksa (§5c) test ortamında: yeni sipariş stoktan düşüyor mu, iptal geri koyuyor mu,
  stok değişikliği Trendyol'a ulaşıyor mu (panelde "onay bekleyen" sıfırlanıyor mu). Trendyol tarih
  filtresinin GMT+3 yorumu ve paket bölme davranışı canlı veriyle doğrulanmalı.
