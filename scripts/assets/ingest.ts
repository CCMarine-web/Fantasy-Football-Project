import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import sharp from "sharp";
import {
  BRAND_SLOTS,
  MANAGER_SLOT_SPECS,
  slotKeyFromFilename,
  slotSpec,
  type BrandAsset,
  type BrandSlot,
} from "../../src/lib/brand-assets";

/**
 * Turns artwork dropped in /asset-inbox into site-ready files.
 *
 *   npm run assets:ingest            process everything in the inbox
 *   npm run assets:ingest -- --status    what has arrived and what is still missing
 *   npm run assets:ingest -- --remove card-blake-mire   take one back out
 *
 * A file is matched to its slot by name (`hero-home.png`, `card-blake-mire.jpg`;
 * case, spaces and a trailing " (1)" are forgiven). Each one is cropped to the
 * slot's aspect ratio around its most interesting region, resized, converted
 * to WebP, written to /public/brand under a content-hashed name, and recorded
 * in src/lib/brand-assets.manifest.json, which is what the components read.
 * The original moves to /asset-inbox/processed.
 */

const ROOT = process.cwd();
const INBOX = join(ROOT, "asset-inbox");
const PROCESSED = join(INBOX, "processed");
const OUT_DIR = join(ROOT, "public", "brand");
const MANIFEST = join(ROOT, "src", "lib", "brand-assets.manifest.json");
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
/** The site's dark background, for opaque slots given art with transparency. */
const PAGE_BACKGROUND = "#10151b";

function readManifest(): Record<string, BrandAsset> {
  return existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, BrandAsset>) : {};
}

function writeManifest(manifest: Record<string, BrandAsset>) {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`);
}

function knownManagerSlugs(): string[] {
  const dir = join(ROOT, "public", "managers");
  return existsSync(dir) ? readdirSync(dir).map((f) => slotKeyFromFilename(f)) : [];
}

function removeOutputs(key: string) {
  if (!existsSync(OUT_DIR)) return;
  for (const f of readdirSync(OUT_DIR)) if (f.startsWith(`${key}.`)) rmSync(join(OUT_DIR, f));
}

async function render(input: Buffer, slot: BrandSlot): Promise<{ data: Buffer; warnings: string[] }> {
  const warnings: string[] = [];
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < slot.width && height < slot.height) {
    warnings.push(`source is ${width}x${height}, smaller than the ${slot.width}x${slot.height} slot, so it will be upscaled`);
  }

  if (slot.transparent) {
    const stats = await sharp(input).stats();
    const alpha = meta.hasAlpha ? stats.channels[3] : null;
    if (!alpha || alpha.min === 255) {
      warnings.push("this slot wants a transparent background and the file has none; regenerate it asking for a transparent PNG");
    }
    // Trim the empty margin, then centre the cut-out in the slot.
    const data = await sharp(input)
      .rotate()
      .trim()
      .resize(slot.width, slot.height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 90, alphaQuality: 100, effort: 6 })
      .toBuffer();
    return { data, warnings };
  }

  const data = await sharp(input)
    .rotate()
    .flatten({ background: PAGE_BACKGROUND })
    .resize(slot.width, slot.height, { fit: "cover", position: sharp.strategy.attention })
    .webp({ quality: 82, effort: 6 })
    .toBuffer();
  return { data, warnings };
}

async function ingest() {
  mkdirSync(INBOX, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(INBOX).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()));
  if (files.length === 0) {
    console.log("asset-inbox is empty. Drop files named after their slot (see ASSETS.md) and run this again.");
    return;
  }

  const manifest = readManifest();
  const managers = knownManagerSlugs();
  let done = 0;
  for (const file of files) {
    const key = slotKeyFromFilename(file);
    const slot = slotSpec(key);
    if (!slot) {
      const near = [...BRAND_SLOTS.map((s) => s.key), ...managers.flatMap((m) => [`card-${m}`, `mugshot-${m}`])]
        .filter((k) => k.includes(key.split("-")[0]) || key.includes(k.split("-")[0]))
        .slice(0, 4);
      console.warn(`skip  ${file}: no slot called "${key}"${near.length ? ` (did you mean ${near.join(", ")}?)` : ""}`);
      continue;
    }
    if (slot.group === "manager" && !managers.includes(key.replace(/^(card|mugshot)-/, ""))) {
      console.warn(`note  ${file}: no manager photo named ${key.replace(/^(card|mugshot)-/, "")}.webp; check the spelling of the name`);
    }

    const { data, warnings } = await render(readFileSync(join(INBOX, file)), slot);
    const hash = createHash("sha1").update(data).digest("hex").slice(0, 8);
    removeOutputs(key);
    writeFileSync(join(OUT_DIR, `${key}.${hash}.webp`), data);
    manifest[key] = { src: `/brand/${key}.${hash}.webp`, width: slot.width, height: slot.height };

    mkdirSync(PROCESSED, { recursive: true });
    renameSync(join(INBOX, file), join(PROCESSED, `${key}${extname(file).toLowerCase()}`));
    console.log(`ok    ${file} -> public/brand/${key}.${hash}.webp (${slot.width}x${slot.height}, ${Math.round(data.length / 1024)} KB)`);
    for (const w of warnings) console.warn(`      warning: ${w}`);
    done += 1;
  }
  writeManifest(manifest);
  console.log(`\n${done} processed. Rebuild or redeploy to see them; commit public/brand and the manifest.`);
}

function status() {
  const manifest = readManifest();
  const managers = knownManagerSlugs();
  const slots = [
    ...BRAND_SLOTS,
    ...managers.flatMap((m) =>
      (Object.keys(MANAGER_SLOT_SPECS) as (keyof typeof MANAGER_SLOT_SPECS)[]).map((kind) => slotSpec(`${kind}-${m}`)!),
    ),
  ];
  for (const priority of ["P1", "P2"] as const) {
    const group = slots.filter((s) => s.priority === priority);
    const missing = group.filter((s) => !manifest[s.key]);
    console.log(`\n${priority}: ${group.length - missing.length} of ${group.length} in place`);
    for (const s of missing) console.log(`  missing  ${s.key}  (${s.width}x${s.height}${s.transparent ? ", transparent" : ""})`);
  }
  const pending = existsSync(INBOX) ? readdirSync(INBOX).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase())) : [];
  if (pending.length) console.log(`\nWaiting in asset-inbox: ${pending.join(", ")}`);
}

function remove(key: string) {
  const manifest = readManifest();
  if (!manifest[key]) {
    console.log(`${key} is not in the manifest.`);
    return;
  }
  delete manifest[key];
  removeOutputs(key);
  writeManifest(manifest);
  console.log(`Removed ${key}; its placeholder is back.`);
}

const args = process.argv.slice(2);
if (args.includes("--status")) status();
else if (args.includes("--remove")) remove(args[args.indexOf("--remove") + 1] ?? "");
else
  ingest().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
