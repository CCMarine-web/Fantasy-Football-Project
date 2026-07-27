import "../lib/load-env";
import { prisma } from "@/lib/db";
import { isAIConfigured } from "@/lib/env";
import {
  generateDraftGradesForSeason,
  revisitDraftGradesForSeason,
} from "@/server/repositories/draft-grade-repository";

/**
 * Regenerates every draft grade with the rebuilt draft-quality model.
 *
 *   npx tsx scripts/ai/regenerate-draft-grades.ts --dry-run
 *   npx tsx scripts/ai/regenerate-draft-grades.ts
 *   npx tsx scripts/ai/regenerate-draft-grades.ts --years 2023,2024
 *
 * Forced by default: the previous grades came from a heuristic that gave
 * nearly everyone a B+, so there is nothing worth preserving. Both the
 * draft-day grade and the separate hindsight grade are rewritten.
 */

function parseYears(): number[] | null {
  const index = process.argv.indexOf("--years");
  if (index === -1 || !process.argv[index + 1]) return null;
  return process.argv[index + 1]
    .split(",")
    .map((y) => Number(y.trim()))
    .filter((y) => Number.isFinite(y));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const onlyYears = parseYears();

  console.log(`=== draft grade regeneration ===${dryRun ? " (DRY RUN)" : ""}`);
  if (!isAIConfigured() && !dryRun) {
    console.log("No OPENAI_API_KEY — letter grades would be written with placeholder commentary.");
    console.log("Refusing; run again once a key is configured.");
    process.exitCode = 2;
    return;
  }

  const seasons = await prisma.season.findMany({
    where: { drafts: { some: {} }, ...(onlyYears ? { year: { in: onlyYears } } : {}) },
    select: { id: true, year: true, status: true },
    orderBy: { year: "asc" },
  });

  let generated = 0;
  let revisited = 0;

  for (const season of seasons) {
    const picks = await prisma.draftPick.count({ where: { draft: { seasonId: season.id } } });
    if (picks === 0) {
      console.log(`  ${season.year}: no picks on record — skipped`);
      continue;
    }
    if (dryRun) {
      console.log(
        `  ${season.year}: would regrade ${picks} pick(s) (${season.status.toLowerCase()})`,
      );
      continue;
    }

    const gen = await generateDraftGradesForSeason(season.id, { force: true });
    generated += gen.created;

    // The hindsight pass only applies to finished seasons.
    const rev = await revisitDraftGradesForSeason(season.id, { force: true });
    revisited += rev.revisited;

    const grades = await prisma.draftGrade.findMany({
      where: { seasonId: season.id },
      orderBy: { originalScore: "desc" },
      select: {
        grade: true,
        originalScore: true,
        revisitedGrade: true,
        manager: { select: { displayName: true } },
      },
    });
    console.log(`  ${season.year}: ${gen.created} graded, ${rev.revisited} revisited`);
    for (const g of grades) {
      console.log(
        `      ${(g.grade ?? "?").padEnd(8)} ${String(g.originalScore?.toFixed(1) ?? "—").padStart(5)}  ${g.manager.displayName.padEnd(20)} revisited=${g.revisitedGrade ?? "—"}`,
      );
    }
  }

  console.log(
    dryRun
      ? "\nDRY RUN — nothing written."
      : `\n${generated} grade(s) written, ${revisited} revisited.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
