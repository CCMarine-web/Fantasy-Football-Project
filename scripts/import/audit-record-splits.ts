import "../lib/load-env";
import { prisma } from "@/lib/db";
import { listManagerRows } from "@/server/repositories/manager-repository";
import { getCareerLuck } from "@/server/repositories/luck-repository";
import { getLastPlaceBySeason } from "@/server/repositories/hall-of-shame-repository";

/**
 * Prints every manager's record split the way the site now defines it, so the
 * records can be eyeballed against each other and against the season tables.
 *
 *   npx tsx scripts/import/audit-record-splits.ts
 *
 * It also lists each season's regular-season last place — the site's only
 * definition of last place — and any postseason game still missing a bracket
 * label, since an unlabelled game cannot count toward the playoff record.
 */

async function main() {
  const [rows, luck, lastPlace] = await Promise.all([
    listManagerRows(),
    getCareerLuck(),
    getLastPlaceBySeason(),
  ]);

  console.log("=== record definitions audit ===\n");
  console.log(
    "manager              regular      win%   playoffs  last  titles  luck  confidence",
  );
  for (const r of [...rows].sort((a, b) => b.winningPercentage - a.winningPercentage)) {
    const l = luck.get(r.managerId);
    console.log(
      `${r.displayName.padEnd(20)} ${`${r.careerWins}-${r.careerLosses}${r.careerTies ? `-${r.careerTies}` : ""}`.padEnd(12)} ` +
        `${(r.winningPercentage * 100).toFixed(1).padStart(5)}  ` +
        `${`${r.playoffWins}-${r.playoffLosses}`.padStart(8)}  ` +
        `${String(r.lastPlaceFinishes).padStart(4)}  ` +
        `${String(r.championships).padStart(6)}  ` +
        `${String(l?.score ?? "—").padStart(4)}  ${l?.confidence ?? "—"}`,
    );
  }

  console.log("\n=== regular-season last place by season ===");
  for (const f of lastPlace) {
    console.log(
      `  ${f.year}  ${f.managerName.padEnd(20)} ${f.record.padEnd(7)} ${f.pointsFor.toFixed(0).padStart(6)} PF  basis=${f.basis}`,
    );
  }

  const untyped = await prisma.matchup.findMany({
    where: { isPlayoff: true, bracketType: null },
    select: {
      week: true,
      season: { select: { year: true } },
      teams: { select: { id: true } },
    },
  });
  const twoSided = untyped.filter((m) => m.teams.length === 2);
  console.log(
    `\npostseason games with no bracket: ${untyped.length} (${twoSided.length} are actual two-team games)`,
  );
  for (const m of twoSided) console.log(`  ${m.season.year} week ${m.week}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
