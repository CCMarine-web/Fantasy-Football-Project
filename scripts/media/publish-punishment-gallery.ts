import "../lib/load-env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { ApprovalStatus, MediaCategory } from "@/generated/prisma/client";

/**
 * Publishes every usable photograph from a folder into the UNLABELLED punishment
 * gallery at the top of the Hall of Shame.
 *
 *   npx tsx scripts/media/publish-punishment-gallery.ts --dry-run
 *   npx tsx scripts/media/publish-punishment-gallery.ts
 *   npx tsx scripts/media/publish-punishment-gallery.ts --dir "C:/path/to/folder"
 *
 * ── Why this exists alongside import-updated-media.ts ──────────────────────
 * That script imports these same files and deliberately holds them back: the
 * filenames are IMG_1364.jpg and similar, so nothing identifies the manager, the
 * season or the punishment, and attaching a real person's face to a punishment
 * they may not have served is worse than showing nothing. So all three sat
 * PENDING in the admin queue and the Hall of Shame showed an empty state
 * explaining why — honest, and also the reason nobody has ever seen them.
 *
 * Publishing them WITHOUT captions resolves that without inventing anything. A
 * photograph with no caption claims nothing; one captioned with a guessed year
 * claims something false. These rows carry no manager, no notes and no season,
 * which is exactly what the miscellaneous gallery reads as "show it, say nothing
 * about it". The labelled, season-attached gallery is unaffected and still needs
 * a human to attach anything it shows.
 *
 * ── Optimisation ──────────────────────────────────────────────────────────
 * 1400px on the long edge, WebP quality 82 — the convention already on disk.
 * Aspect ratio is preserved (only one dimension is constrained) and EXIF
 * orientation is applied before resizing, so a portrait photo taken on a phone
 * is not served on its side. The stored width and height are the OUTPUT
 * dimensions, which is what lets the gallery reserve the right space and avoid
 * reflowing as each image loads.
 *
 * Re-running is safe. The output filename is a content hash, so an unchanged
 * photograph resolves to the same row and only its flags are refreshed.
 */

const DEFAULT_DIR = "C:\\Users\\antho\\Downloads\\Punishment pictures";
const OUT_DIR = join(process.cwd(), "public", "punishments");

/** Extensions sharp can decode in this environment. */
const USABLE = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".tiff", ".avif"]);

/** Files a photo folder collects that are not photographs. */
const IGNORED = new Set(["thumbs.db", ".ds_store", "desktop.ini"]);

const LONG_EDGE = 1400;
const QUALITY = 82;

function parseArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sha(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const dir = parseArg("--dir") ?? DEFAULT_DIR;

  console.log(`=== unlabelled punishment gallery ===${dryRun ? " (DRY RUN)" : ""}`);
  console.log(`source: ${dir}`);

  if (!existsSync(dir)) {
    console.log("Folder not found — nothing to publish.");
    process.exitCode = 2;
    return;
  }

  const all = readdirSync(dir).filter((name) => !IGNORED.has(name.toLowerCase()));
  const files = all
    .filter((name) => USABLE.has(extname(name).toLowerCase()))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
  const rejected = all.filter((name) => !files.includes(name));

  console.log(`${files.length} photograph(s) found${rejected.length > 0 ? `, ${rejected.length} other file(s) ignored: ${rejected.join(", ")}` : ""}\n`);

  if (!dryRun && files.length > 0) mkdirSync(OUT_DIR, { recursive: true });

  let published = 0;
  let refreshed = 0;
  let unreadable = 0;

  for (const [index, file] of files.entries()) {
    if (dryRun) {
      console.log(`  would publish ${file}`);
      continue;
    }

    let output: Buffer;
    let width: number | null = null;
    let height: number | null = null;
    try {
      const input = readFileSync(join(dir, file));
      output = await sharp(input)
        .rotate() // apply EXIF orientation BEFORE measuring or resizing
        .resize(LONG_EDGE, LONG_EDGE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer();
      const meta = await sharp(output).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch (error) {
      // "Every usable photo" — a file sharp cannot decode is not usable, and one
      // corrupt file should not stop the rest being published.
      console.log(
        `  ${file}: not a readable image (${error instanceof Error ? error.message.slice(0, 80) : "unknown"}) — skipped`,
      );
      unreadable += 1;
      continue;
    }

    const outName = `punishment-${sha(output)}.webp`;
    writeFileSync(join(OUT_DIR, outName), output);
    const url = `/punishments/${outName}`;

    const existing = await prisma.mediaAsset.findFirst({ where: { url }, select: { id: true } });
    const data = {
      kind: "image",
      originalFilename: basename(file),
      url,
      width,
      height,
      fileSizeBytes: output.length,
      category: MediaCategory.PUNISHMENT,
      approvalStatus: ApprovalStatus.APPROVED,
      isPublished: true,
      // No manager, no notes, no season. Nothing about which punishment this
      // shows can be established from the file, so nothing is asserted — and the
      // gallery renders it without a caption for the same reason.
      managerId: null,
      sortOrder: index,
      notes: null,
    };

    if (existing) {
      await prisma.mediaAsset.update({ where: { id: existing.id }, data });
      refreshed += 1;
    } else {
      await prisma.mediaAsset.create({ data });
      published += 1;
    }

    console.log(
      `  ${file.padEnd(20)} -> ${url}  ${width}x${height}  ${Math.round(output.length / 1024)}kB  ${existing ? "refreshed" : "published"}`,
    );
  }

  if (dryRun) {
    console.log("\nDRY RUN — nothing written.");
    return;
  }

  const total = await prisma.mediaAsset.count({
    where: {
      category: MediaCategory.PUNISHMENT,
      isPublished: true,
      approvalStatus: ApprovalStatus.APPROVED,
    },
  });
  console.log(
    `\n${published} new, ${refreshed} refreshed${unreadable > 0 ? `, ${unreadable} unreadable` : ""}. ` +
      `${total} photograph(s) now in the gallery.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
