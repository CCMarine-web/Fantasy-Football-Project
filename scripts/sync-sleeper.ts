import "dotenv/config";
import { prisma } from "@/lib/db";
import { isSleeperConfigured } from "@/lib/env";
import { syncAllConnectedSeasons, syncCurrentLeague, recalculateStatistics } from "@/server/sleeper";

/**
 * Re-syncs Sleeper data into the database. Safe to re-run — every sync step
 * upserts, it never deletes unrelated data. Run with:
 *
 *   npm run sync:sleeper              # sync every connected season (current + full history)
 *   npm run sync:sleeper -- --current # sync only the current season (faster)
 *
 * Requires SLEEPER_LEAGUE_ID to be set in .env; otherwise this runs against
 * the mock provider, which is only useful for local testing.
 */
async function main(): Promise<void> {
  if (!isSleeperConfigured()) {
    console.warn("SLEEPER_LEAGUE_ID is not set — syncing against the mock provider.");
  }

  const currentOnly = process.argv.includes("--current");

  if (currentOnly) {
    console.log("Syncing current season only...");
    const result = await syncCurrentLeague();
    console.log("Synced season:", result.seasonId, "— records processed:", result.recordsProcessed);
  } else {
    console.log("Syncing every connected season (this walks the full league history)...");
    const result = await syncAllConnectedSeasons();
    console.log("Seasons processed:", result.seasonsProcessed);
  }

  console.log("Recalculating standings/statistics...");
  await recalculateStatistics();

  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
