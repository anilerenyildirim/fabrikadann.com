# syntax=docker/dockerfile:1
# Canlı imaj: Next.js standalone çıktısı + migration/yönetim betikleri.
# Temel imaj sürümü sabit; güncellerken etiketi bilinçli olarak yükseltin.
ARG NODE_IMAGE=node:24.11.1-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Çalışma zamanı için yalnızca üretim bağımlılıkları (geliştirme araçları imaja girmez)
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# Playwright, Next'in isteğe bağlı eşi olarak "devOptional" kalır; canlıda gereksiz
RUN npm ci --omit=dev && rm -rf node_modules/playwright node_modules/playwright-core node_modules/@playwright

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Modüller derleme sırasında içe aktarılırken bu değişkenleri arar; gerçek değerler çalışma anında verilir
ARG APP_URL=https://fabrikadann.com
RUN DATABASE_URL=postgres://derleme:derleme@127.0.0.1:1/derleme \
    SESSION_SECRET=derleme-zamani-yer-tutucu-gercek-degil-0000000 \
    APP_URL=$APP_URL \
    npm run build

FROM ${NODE_IMAGE} AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system app && useradd --system --gid app --home /app app
# Uygulama (dosyalar root'a ait: çalışan süreç kodu değiştiremez)
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Migration, yönetici oluşturma ve bakım betikleri (yalnızca üretim bağımlılıklarıyla)
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.ts /app/scripts/create-admin.ts /app/scripts/maintenance.ts ./scripts/
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json /app/package.json ./
# Uygulama kullanıcısı yalnızca yüklenen görseller klasörüne yazabilir
RUN mkdir -p /app/uploads && chown app:app /app/uploads
USER app
EXPOSE 3000
CMD ["node", "server.js"]
