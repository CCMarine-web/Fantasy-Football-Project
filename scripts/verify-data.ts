import "./lib/load-env";
import { prisma } from "@/lib/db";
import { verifyAllData } from "@/server/verify/data-verification";

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
  if (report.totalMismatches > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
