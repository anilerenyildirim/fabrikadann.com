// Marka JPG'lerinden vektör logo üretir: node scripts/trace-logo.mjs
import sharp from "sharp";
import potrace from "potrace";
import { readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

const trace = promisify(potrace.trace);

async function vectorize(src, region, out) {
  const base = region ? await sharp(src).extract(region).toBuffer() : src;
  const trimmed = await sharp(base).greyscale().trim({ threshold: 40 }).toBuffer({ resolveWithObject: true });
  const scale = 6;
  const { width, height } = trimmed.info;
  const big = await sharp(trimmed.data).resize(width * scale, height * scale, { kernel: "lanczos3" }).png().toBuffer();
  const svg = await trace(big, { threshold: 128, turdSize: 20, optTolerance: 0.4 });
  const d = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(" ");
  const vb = `0 0 ${width * scale} ${height * scale}`;
  writeFileSync(
    out,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="currentColor"><path fill-rule="evenodd" d="${d}"/></svg>\n`,
  );
  console.log(out, width, height);
}

await vectorize("brand/marka-ornegi-2-sadece-yazi-beyaz-zemin.jpg", null, "public/brand/wordmark.svg");
// Monogram (public/brand/monogram.svg) geometrik olduğu için elle çizildi; izlenmez.

// Bileşenlerin dosya okumadan kullanabilmesi için yolu bir TS modülüne de yaz
const wordmark = readFileSync("public/brand/wordmark.svg", "utf8");
writeFileSync(
  "src/components/brand/wordmark-path.ts",
  `// scripts/trace-logo.mjs tarafından üretildi\nexport const WORDMARK_VIEWBOX = "${/viewBox="([^"]+)"/.exec(wordmark)[1]}";\nexport const WORDMARK_PATH =\n  "${/ d="([^"]+)"/.exec(wordmark)[1]}";\n`,
);
