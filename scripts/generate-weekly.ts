import "dotenv/config";
import { prisma } from "@/lib/db";
import { generateWeeklyContent } from "@/server/ai/weekly-pipeline";

/**
 * Manually run the weekly AI content pipeline. Useful in the offseason to test
 * generation against a past week, and as a fallback to the Vercel cron.
 *
 *   npm run generate:weekly                       # current season, latest week, syncs first
 *   npm run generate:weekly -- --season 2025 --recap-week 14 --preview-week 15 --no-sync
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const seasonYear = arg("season");
  const recapWeek = arg("recap-week");
  const previewWeek = arg("preview-week");
  const noSync = process.argv.includes("--no-sync");

  let seasonId: string | undefined;
  if (seasonYear) {
    const s = await prisma.season.findFirst({ where: { year: Number(seasonYear) } });
    seasonId = s?.id;
    if (!seasonId) throw new Error(`No season found for year ${seasonYear}`);
  }

  const result = await generateWeeklyContent({
    seasonId,
    recapWeek: recapWeek ? Number(recapWeek) : undefined,
    previewWeek: previewWeek ? Number(previewWeek) : undefined,
    sync: !noSync,
  });
  console.log("Weekly pipeline result:", JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
