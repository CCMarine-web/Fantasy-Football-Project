import "./lib/load-env";
import { prisma } from "@/lib/db";
import { textStatus } from "@/server/text/status";

/**
 * Fails (exit 1) if any AI text on the site is out of date: missing, or
 * written from facts that no longer match what the page shows. Run after a
 * full pipeline run; the pipeline's own generate step reports the same count.
 *
 *   npm run verify:texts
 */
async function main() {
  const s = await textStatus();
  console.log(`${s.total} texts · ${s.stale} stale · ${s.fallback} on templated fallback`);
  for (const [kind, k] of Object.entries(s.byKind)) console.log(`  ${kind.padEnd(16)} ${String(k.total).padStart(3)} total  ${k.stale} stale`);
  if (s.stale > 0) {
    console.log(`Stale: ${s.staleKeys.join(", ")}`);
    process.exitCode = 1;
  }
}
main().finally(() => prisma.$disconnect());
