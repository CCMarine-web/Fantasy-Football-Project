import "./lib/load-env";
import { prisma } from "@/lib/db";
import { ALL_STEPS, runPipeline, type PipelineJob, type StepKey } from "@/server/pipeline/run";

/**
 * Run the data pipeline by hand — the same code the cron jobs run.
 *
 *   npm run pipeline                         # the weekly rebuild, all steps
 *   npm run pipeline -- --job daily          # daily | weekly | thursday | manual
 *   npm run pipeline -- --week 9             # backfill / redo a specific week
 *   npm run pipeline -- --steps compute,generate-text
 *   npm run pipeline -- --force-text         # regenerate text even if its facts are unchanged
 *   npm run pipeline -- --no-model           # templated text only, no AI calls
 *   npm run pipeline -- --budget 1800        # seconds (default 1800 from the CLI)
 *   npm run pipeline -- --steps sync --backfill-projections 100   # fill missing player projections
 *
 * A CLI run isn't bound by Vercel's 300-second limit, so the default budget is
 * 30 minutes — enough for a full first-time generation. It clears the live
 * site's caches only when SITE_URL and CRON_SECRET are set (see
 * server/pipeline/revalidate.ts); otherwise caches expire within the hour.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const job = (arg("job") ?? "weekly") as PipelineJob;
  if (!["daily", "weekly", "thursday", "manual"].includes(job)) throw new Error(`Unknown job "${job}"`);
  const week = arg("week") ? Number(arg("week")) : undefined;
  const steps = arg("steps")?.split(",").map((s) => s.trim()) as StepKey[] | undefined;
  if (steps?.some((s) => !ALL_STEPS.includes(s))) throw new Error(`Steps must be among ${ALL_STEPS.join(", ")}`);

  console.log(`Running ${job}${week ? ` for week ${week}` : ""}${steps ? ` (steps: ${steps.join(", ")})` : ""}…`);
  const result = await runPipeline({
    job,
    trigger: "cli",
    week,
    steps,
    forceText: process.argv.includes("--force-text"),
    noModel: process.argv.includes("--no-model"),
    budgetMs: Number(arg("budget") ?? 1800) * 1000,
    projectionBackfillWeeks: arg("backfill-projections") ? Number(arg("backfill-projections")) : undefined,
  });

  console.log(`\n${result.status} in ${(result.durationMs / 1000).toFixed(1)}s · season ${result.seasonYear ?? "—"} · week ${result.week ?? "—"} · ${result.phase ?? ""}`);
  for (const s of result.steps) {
    console.log(`  ${s.status.padEnd(8)} ${s.key.padEnd(14)} ${(s.durationMs / 1000).toFixed(1).padStart(6)}s  ${s.detail}`);
  }
  console.log(`  counts: ${JSON.stringify(result.counts)}`);
  if (result.status === "FAILED") process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
