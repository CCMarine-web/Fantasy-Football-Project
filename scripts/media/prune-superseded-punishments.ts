import "../lib/load-env";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";

/**
 * Removes punishment MediaAsset rows whose file no longer exists on disk.
 *
 *   npx tsx scripts/media/prune-superseded-punishments.ts --dry-run
 *   npx tsx scripts/media/prune-superseded-punishments.ts
 *
 * ── Why there are any ─────────────────────────────────────────────────────
 * Output filenames are content hashes. The first import resized these
 * photographs by constraining WIDTH to 1400; the gallery import constrains the
 * LONG EDGE instead, because all three are portrait phone photos and the old
 * rule was upscaling them. Different bytes, different hash, so each photograph
 * produced a second row and the originals were left behind: unpublished, PENDING,
 * invisible to readers, and counted in the admin banner that says how many
 * photographs still need attaching. That banner asking an admin to attach three
 * photographs that are already published is the only symptom, and it is enough.
 *
 * Only rows whose file is genuinely gone are removed, and only PENDING ones —
 * an approved, published row is never touched, whatever the state of the disk.
 */

const PUBLIC_DIR = join(process.cwd(), "public");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`=== prune superseded punishment media ===${dryRun ? " (DRY RUN)" : ""}`);

  const rows = await prisma.mediaAsset.findMany({
    where: { category: "PUNISHMENT" },
    select: {
      id: true,
      url: true,
      originalFilename: true,
      approvalStatus: true,
      isPublished: true,
    },
    orderBy: { createdAt: "asc" },
  });

  /*
   * A PENDING row is superseded when the SAME source photograph already has an
   * approved, published row. `originalFilename` is the link: both imports record
   * the file they came from, so "IMG_1364.jpg pending" and "IMG_1364.jpg
   * published" are provably two encodings of one photograph, not two
   * photographs. Nothing is matched on image content or on a guess.
   */
  const publishedSources = new Set(
    rows
      .filter((r) => r.isPublished && r.approvalStatus === "APPROVED")
      .map((r) => r.originalFilename.toLowerCase()),
  );

  const superseded = rows.filter(
    (row) =>
      row.approvalStatus === "PENDING" &&
      !row.isPublished &&
      publishedSources.has(row.originalFilename.toLowerCase()),
  );

  const orphans = rows.filter((row) => {
    if (row.approvalStatus !== "PENDING" || row.isPublished) return false;
    if (superseded.some((s) => s.id === row.id)) return false;
    // Local /public paths only; a remote URL cannot be checked this way.
    if (!row.url.startsWith("/")) return false;
    return !existsSync(join(PUBLIC_DIR, row.url.replace(/^\//, "")));
  });

  console.log(
    `${rows.length} punishment asset(s), ${superseded.length} superseded, ${orphans.length} orphaned\n`,
  );

  for (const row of superseded) {
    console.log(`  ${row.originalFilename} -> ${row.url} (superseded by a published encoding)`);
    if (!dryRun) {
      await prisma.mediaAsset.delete({ where: { id: row.id } });
      const path = join(PUBLIC_DIR, row.url.replace(/^\//, ""));
      if (row.url.startsWith("/punishments/") && existsSync(path)) unlinkSync(path);
    }
  }

  for (const row of orphans) {
    console.log(`  ${row.originalFilename} -> ${row.url} (file missing)`);
    if (!dryRun) await prisma.mediaAsset.delete({ where: { id: row.id } });
  }

  /*
   * Files on disk with no row pointing at them. These are the actual leftovers
   * from the superseded resize. Reported rather than deleted by default —
   * deleting an image because no row references it is exactly the operation that
   * goes wrong if a row is added moments later.
   */
  const referenced = new Set(rows.map((r) => r.url));
  const { readdirSync } = await import("node:fs");
  const dir = join(PUBLIC_DIR, "punishments");
  const stray = existsSync(dir)
    ? readdirSync(dir).filter((name) => !referenced.has(`/punishments/${name}`))
    : [];

  if (stray.length > 0) {
    console.log(`\n${stray.length} file(s) on disk with no database row:`);
    for (const name of stray) console.log(`  /punishments/${name}`);
    if (process.argv.includes("--delete-stray-files")) {
      if (dryRun) {
        console.log("  (dry run — not deleted)");
      } else {
        for (const name of stray) unlinkSync(join(dir, name));
        console.log(`  deleted ${stray.length} file(s)`);
      }
    } else {
      console.log("  Pass --delete-stray-files to remove them.");
    }
  }

  console.log(
    dryRun
      ? "\nDRY RUN — nothing written."
      : `\nRemoved ${superseded.length + orphans.length} row(s).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
