import "./lib/load-env";
import { prisma } from "@/lib/db";
import { verifyAllData } from "@/server/verify/data-verification";
import { verifyHeadToHeadConsistency } from "@/server/verify/head-to-head-consistency";
import { getCareerLuckWins, getSeasonLuckWins } from "@/server/repositories/luck-repository";

/**
 * Reconciles stored league data against its sources. Read-only.
 *
 *   npm run verify:data                      # every season
 *   npm run verify:data -- --years 2025,2026
 *   npm run verify:data -- --json            # machine-readable report
 *
 * Exit code 1 when anything disagrees, so it can gate a deploy or a CI job.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const years = arg("years")?.split(",").map(Number).filter(Number.isFinite);
  const report = await verifyAllData({ years });

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Data verification — ${report.checkedAt}\n`);
    for (const s of report.seasons) {
      const head = `${s.year} (${s.dataSource})`.padEnd(16);
      if (s.error) {
        console.log(`${head} ERROR: ${s.error}`);
        continue;
      }
      const weeks = s.weeksChecked.length ? `weeks ${s.weeksChecked[0]}-${s.weeksChecked.at(-1)}` : "no final weeks";
      const notes = s.mismatches.length - s.errors;
      console.log(`${head} ${String(s.teamsChecked).padStart(2)} teams  ${String(s.scoresChecked).padStart(4)} scores  ${weeks.padEnd(12)}  ${s.errors === 0 ? "OK" : `${s.errors} MISMATCH(ES)`}${notes ? `  (${notes} source discrepanc${notes === 1 ? "y" : "ies"})` : ""}`);
      for (const x of s.mismatches.slice(0, 40)) {
        const tag = x.severity === "error" ? x.scope : `${x.scope}, source discrepancy`;
        console.log(`    [${tag}] ${x.subject} — ${x.field}: ours ${x.actual}, ${x.source} says ${x.expected}`);
      }
      if (s.mismatches.length > 40) console.log(`    … ${s.mismatches.length - 40} more`);
    }
    console.log(`\n${report.totalMismatches === 0 ? "All seasons reconcile." : `${report.totalMismatches} problem(s) found.`}`);
  }
  // Cross-page head-to-head: stored rivalry vs profile vs matchup card.
  const h2h = await verifyHeadToHeadConsistency();
  if (!process.argv.includes("--json")) {
    console.log(`
Head-to-head consistency: ${h2h.pairsChecked} pairs, ${h2h.problems.length === 0 ? "rivalry, profile and matchup paths agree" : `${h2h.problems.length} DISAGREE`}`);
    for (const p of h2h.problems) console.log(`    ${p.pair}: rivalry ${p.rivalry}, profile ${p.profile}, matchup ${p.matchup}`);
  }
  // Luck in wins: Σ luck = 0 and Σ expected = games, every season and career.
  const luckProblems: string[] = [];
  const seasons = await prisma.season.findMany({ select: { year: true }, orderBy: { year: "asc" } });
  const check = (label: string, m: Map<string, { luckWins: number; expected: number; games: number }>) => {
    const v = [...m.values()];
    if (v.length === 0) return;
    const sum = v.reduce((s, x) => s + x.luckWins, 0);
    const exp = v.reduce((s, x) => s + x.expected, 0);
    const games = v.reduce((s, x) => s + x.games, 0) / 2;
    if (Math.abs(sum) > 0.05 || Math.abs(exp - games) > 0.05) luckProblems.push(`${label}: Σluck ${sum.toFixed(3)}, Σexpected ${exp.toFixed(2)} vs ${games} games`);
  };
  for (const s of seasons) check(String(s.year), await getSeasonLuckWins(s.year));
  check("career", await getCareerLuckWins());
  if (!process.argv.includes("--json")) {
    console.log(`Luck in wins: ${luckProblems.length === 0 ? "sums to zero and expected wins equal games played, every season and career" : luckProblems.join("; ")}`);
  }
  if (report.totalMismatches > 0 || h2h.problems.length > 0 || luckProblems.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
