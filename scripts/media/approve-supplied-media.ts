import "../lib/load-env";
import { prisma } from "@/lib/db";

/**
 * Approves the media that was supplied directly by the commissioner for public
 * use: the ten manager profile photos and the league photos used as page
 * backgrounds. Idempotent — re-running is a no-op.
 *
 *   npx tsx scripts/media/approve-supplied-media.ts
 *
 * Why this exists: MediaAsset rows land as PENDING on import (admin-gated by
 * design). Two profile photos (Patrick Schwing, Quinn Fuentes) were left
 * PENDING, so they silently didn't render anywhere the UI filters on APPROVED.
 * The files themselves were always correct — this only flips the review flag.
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const pending = await prisma.mediaAsset.findMany({
    where: {
      approvalStatus: "PENDING",
      category: { in: ["PROFILE", "HOMEPAGE_HERO", "BACKGROUND", "HISTORY", "EVENT"] },
    },
    select: {
      id: true,
      category: true,
      originalFilename: true,
      url: true,
      manager: { select: { displayName: true } },
    },
    orderBy: [{ category: "asc" }, { originalFilename: "asc" }],
  });

  if (pending.length === 0) {
    console.log("No pending media — all supplied assets are already approved.");
  } else {
    console.log(`${pending.length} pending asset(s):`);
    for (const a of pending) {
      console.log(`  [${a.category}] ${a.originalFilename} -> ${a.url}${a.manager ? `  (manager: ${a.manager.displayName})` : ""}`);
    }
  }

  if (dryRun) {
    console.log("\n--dry-run: no changes written.");
    return;
  }

  if (pending.length > 0) {
    const result = await prisma.mediaAsset.updateMany({
      where: { id: { in: pending.map((a) => a.id) } },
      data: { approvalStatus: "APPROVED", isPublished: true },
    });
    console.log(`Approved + published ${result.count} asset(s).`);
  }

  // Always run: approving an asset is only half the job, and a previous run may
  // have approved without wiring.
  await wireManagerPhotos();
}

/**
 * Public pages render `Manager.photoUrl ?? Manager.avatarUrl` — they never read
 * MediaAsset. So approving a PROFILE asset is not enough; the manager row has
 * to point at it. Two managers (Patrick Schwing, Quinn Fuentes) were imported
 * with photoConfident:false, which left photoUrl null and fell back to a raw
 * Sleeper avatar hash (not a URL) — a broken image. The filenames are exact
 * full-name matches to each manager's FULL_NAME alias, the same rule that
 * mapped the other eight correctly, so wiring them is safe.
 */
async function wireManagerPhotos() {
  const assets = await prisma.mediaAsset.findMany({
    where: { category: "PROFILE", approvalStatus: "APPROVED", managerId: { not: null } },
    select: { url: true, managerId: true, originalFilename: true },
  });

  let wired = 0;
  for (const a of assets) {
    const manager = await prisma.manager.findUnique({
      where: { id: a.managerId! },
      select: { id: true, displayName: true, photoUrl: true },
    });
    if (!manager || manager.photoUrl === a.url) continue;
    await prisma.manager.update({ where: { id: manager.id }, data: { photoUrl: a.url } });
    console.log(`  wired ${manager.displayName} -> ${a.url} (from ${a.originalFilename})`);
    wired++;
  }
  console.log(wired ? `Wired ${wired} manager photo(s).` : "All manager photos already wired.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
