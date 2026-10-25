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

İmajı sunucuda değil, kendi bilgisayarınızda ya da CI'da derleyin (`next build` çok bellek ister):

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
POSTGRES_PASSWORD=<uzun rastgele>
SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))">
PAYMENT_PROVIDER=mock          # iyzico entegrasyonu eklenince: iyzico
CLIENT_IP_HEADER=x-real-ip     # Cloudflare kullanılırsa: cf-connecting-ip
SMTP_URL=smtps://kullanici:parola@smtp.saglayici.com:465
MAIL_FROM="fabrikadann <siparis@fabrikadann.com>"
```

`PAYMENT_PROVIDER=mock` canlıda yalnızca yönetici oturumuyla çalışır (müşteriler sahte ödemeyle
sipariş tamamlayamaz). Gerçek satışa iyzico entegrasyonu eklenmeden başlanmamalıdır.

## 4. İlk kurulum

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production up -d db
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production run --rm app npx tsx scripts/migrate.ts
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

## 6. Yedekleme (zorunlu)

Sipariş verisi en kritik varlıktır. Her gece veritabanı ve görseller sunucu dışına yedeklenmeli:

```cron
30 3 * * * docker compose -f /srv/fabrikadann/deploy/docker-compose.prod.yml exec -T db pg_dump -U fabrikadann -Fc fabrikadann > /yedek/db-$(date +\%F).dump
```

Yedekleri sunucu dışına (ör. başka bir bulut depolama) kopyalayın ve geri yüklemeyi en az bir kez deneyin.

## 7. Güncelleme

Yeni imajı yükleyin, migration'ları çalıştırın, uygulamayı yeniden başlatın:

```bash
docker compose ... run --rm app npx tsx scripts/migrate.ts
docker compose ... up -d app
```

## 8. Canlıya çıkmadan önce yapılacaklar

- [ ] iyzico üye işyeri anlaşması → `src/server/payments` altına Checkout Form adaptörü, `PAYMENT_PROVIDER=iyzico`, CSP `form-action`'a iyzico alan adı.
- [ ] Yasal metinlerin (mesafeli satış, ön bilgilendirme, KVKK, çerez, iade) avukat kontrolü; iade kargo koşulunun belirlenmesi.
- [ ] Ayarlar'dan şirket bilgileri.
- [ ] Gerçek ürün fotoğrafları (4:5 dikey oran, en az 1600 px genişlik önerilir).
- [ ] SMTP (sipariş ve parola e-postaları için) — SPF/DKIM kayıtları.
- [ ] Alan adı DNS'i sunucuya (Cloudflare kullanılacaksa proxy açık + `CLIENT_IP_HEADER=cf-connecting-ip`).
- [ ] Yedeklemenin çalıştığının doğrulanması.
- [ ] e-Fatura/e-Arşiv entegrasyonu (muhasebe sürecinize göre).
