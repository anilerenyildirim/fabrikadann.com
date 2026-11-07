import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, expect, test } from "vitest";
import { mediaJpegUrl, readMedia, storeProductImage } from "@/server/storage/images";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "fd-medya-"));
  process.env.UPLOAD_DIR = dir;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const png = () => sharp({ create: { width: 500, height: 600, channels: 3, background: { r: 200, g: 10, b: 10 } } }).png().toBuffer();

test("webp ve jpg adresleri aynı görseli doğru türde verir; bilinmeyen uzantı yok", async () => {
  const { key } = await storeProductImage(await png());
  const webp = await readMedia(`${key}-800.webp`);
  expect(webp?.contentType).toBe("image/webp");
  const jpg = await readMedia(`${key}-1200.jpg`);
  expect(jpg?.contentType).toBe("image/jpeg");
  expect((await sharp(jpg!.body).metadata()).format).toBe("jpeg");
  expect(await readMedia(`${key}-800.png`)).toBeNull();
  expect(await readMedia(`../${key}-800.jpg`)).toBeNull();
  expect(mediaJpegUrl(key, 1200)).toBe(`/medya/${key}-1200.jpg`);
});
