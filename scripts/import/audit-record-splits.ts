import "../lib/load-env";
import { prisma } from "@/lib/db";
import { listManagerRows } from "@/server/repositories/manager-repository";
import { getCareerLuck } from "@/server/repositories/luck-repository";

/**
 * Prints every manager's record split the way the site now defines it, so the
 * three records can be eyeballed against each other and against the season
 * tables.
 *
 *   npx tsx scripts/import/audit-record-splits.ts
 *
 * It also reports any postseason game still missing a bracket label, because
 * those appear in neither the playoff nor the consolation column and the pages
 * have to say so.
 */

async function main() {
  const [rows, luck] = await Promise.all([listManagerRows(), getCareerLuck()]);

  console.log("=== record definitions audit ===\n");
  console.log(
    "manager              regular      win%   playoffs  consol.  titles  luck  confidence",
  );
  for (const r of [...rows].sort((a, b) => b.winningPercentage - a.winningPercentage)) {
    const l = luck.get(r.managerId);
    console.log(
      `${r.displayName.padEnd(20)} ${`${r.careerWins}-${r.careerLosses}${r.careerTies ? `-${r.careerTies}` : ""}`.padEnd(12)} ` +
        `${(r.winningPercentage * 100).toFixed(1).padStart(5)}  ` +
        `${`${r.playoffWins}-${r.playoffLosses}`.padStart(8)}  ` +
        `${`${r.consolationWins}-${r.consolationLosses}`.padStart(7)}  ` +
        `${String(r.championships).padStart(6)}  ` +
        `${String(l?.score ?? "—").padStart(4)}  ${l?.confidence ?? "—"}`,
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
