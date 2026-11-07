// Yönetim uygulamasının (PWA) simgeleri: logodaki işaretten PNG üretir. Bir kez çalıştırılır, çıktılar depoda.
// npx tsx scripts/make-pwa-icons.ts
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const MARK = '<path id="i" d="M0 28H105V455L573 0V672H468V245L0 700Z"/><use href="#i" transform="translate(1400 0) scale(-1 1)"/>';

/** 64 birimlik tuvalde işaret; scale < 1 kenar boşluğunu artırır (maskeli simge için güvenli alan). */
function svg(background: string | null, scale = 1) {
  const s = 0.0329 * scale;
  const w = 1400 * s;
  const h = 700 * s;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${background ? `<rect width="64" height="64" fill="${background}"/>` : ""}` +
      `<g fill="#fff" transform="translate(${(64 - w) / 2} ${(64 - h) / 2}) scale(${s})">${MARK}</g></svg>`,
  );
}

const out = "public/yonetim";
await mkdir(out, { recursive: true });
const jobs: [string, Buffer, number][] = [
  ["icon-192.png", svg("#000"), 192],
  ["icon-512.png", svg("#000"), 512],
  ["icon-maskable-512.png", svg("#000", 0.75), 512],
  ["apple-touch-icon.png", svg("#000", 0.85), 180],
  // Android durum çubuğu rozeti: yalnızca saydamlık kullanılır
  ["badge-96.png", svg(null, 1.15), 96],
];
for (const [name, source, size] of jobs) {
  await sharp(source, { density: 1200 }).resize(size, size).png().toFile(`${out}/${name}`);
  const m = await sharp(`${out}/${name}`).metadata();
  console.log(name, `${m.width}x${m.height}`);
}
