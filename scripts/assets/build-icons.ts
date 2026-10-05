import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

/**
 * Renders the raster icons from the vector one, so the favicon, the Apple
 * touch icon and the masthead mark never drift apart:
 *
 *   src/app/icon.svg  ->  src/app/apple-icon.png (180x180)
 *                         src/app/favicon.ico    (16, 32 and 48px)
 *
 *   npx tsx scripts/assets/build-icons.ts
 *
 * Re-run after editing icon.svg. The outputs are committed; Next serves them
 * through its icon file conventions.
 */
const APP = join(process.cwd(), "src", "app");
const svg = readFileSync(join(APP, "icon.svg"));

// icon.svg is drawn at 512px, so it is rasterised large and scaled down.
const png = (size: number, opaque = false) => {
  const img = sharp(svg).resize(size, size);
  // iOS rounds the corners itself and paints transparent ones black.
  return (opaque ? img.flatten({ background: "#10151b" }) : img).png({ compressionLevel: 9 }).toBuffer();
};

/** An ICO is a directory of PNGs; every browser since IE9 reads PNG entries. */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // no palette
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

async function main() {
  writeFileSync(join(APP, "apple-icon.png"), await png(180, true));
  const sizes = [16, 32, 48];
  writeFileSync(join(APP, "favicon.ico"), ico(await Promise.all(sizes.map(async (size) => ({ size, data: await png(size) })))));
  console.log("Wrote src/app/apple-icon.png and src/app/favicon.ico");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
