import "../lib/load-env";
import { spawnSync } from "node:child_process";
import { prisma } from "@/lib/db";
import { isAIConfigured } from "@/lib/env";
import { ensureAllPastSeasonsGraded } from "@/server/repositories/draft-grade-repository";

/**
 * Recomputes everything that is DERIVED from season results, after an import
 * changes them (in practice: after the ESPN history import).
 *
 *   npx tsx scripts/import/recalculate-derived-stats.ts
 *   npx tsx scripts/import/recalculate-derived-stats.ts --skip-ai
 *
 * ── What needs recomputing, and what doesn't ──────────────────────────────
 * Most of the site's statistics are computed at read time straight from
 * MatchupTeam / FantasyTeam rows, so they pick up new seasons with no action
 * here. That covers career records, the /records page, standings, all-play and
 * luck figures, finish distributions and head-to-head tables.
 *
 * What IS persisted, and therefore goes stale:
 *   1. Rivalry + RivalryMeeting     - head-to-head aggregates and the meeting log.
 *   2. DraftGrade                   - one per manager per season, with rationale.
 *   3. ManagerPerformanceSummary    - written from career totals.
 *   4. AIBlurbCache / Rivalry.summary - commentary keyed by a hash of the numbers.
 *
 * Steps 3 and 4 call a model, so they are skipped when no API key is set (and
 * can be skipped explicitly with --skip-ai). Steps 1 and 2's letter grades are
 * deterministic and always run.
 */

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

const results: Step[] = [];

function runScript(name: string, script: string, args: string[] = []): void {
  console.log(`\n=== ${name} ===`);
  const run = spawnSync("npx", ["tsx", script, ...args], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const ok = run.status === 0;
  results.push({
    name,
    ok,
    detail: ok ? "completed" : `exited with status ${run.status ?? "unknown"}`,
  });
}

async function main() {
  const skipAI = process.argv.includes("--skip-ai");

  const seasons = await prisma.season.groupBy({ by: ["dataSource"], _count: true });
  console.log("=== recalculating derived statistics ===");
  console.log(
    `seasons in database: ${seasons.map((s) => `${s.dataSource}=${s._count}`).join(", ")}`,
  );

  // 1. Rivalries — pure recomputation from verified results.
  runScript(
    "rivalries (head-to-head aggregates + meeting log)",
    "scripts/import/import-rivalries.ts",
  );

  // 2. Draft grades. The letter grades are deterministic; the rationale prose
  // comes from the model, so on a mock provider the letters still land and the
  // prose is simply placeholder text that the page declines to show.
  console.log("\n=== draft grades ===");
  try {
    const graded = await ensureAllPastSeasonsGraded({ backfillMissingCommentary: true });
    console.log(
      `covered ${graded.seasons} completed season(s): ${graded.generated} grade(s) generated, ${graded.revisited} revisited from final standings`,
    );
    if (graded.backfilledSeasons.length > 0) {
      console.log(
        `re-ran season(s) whose grades had no commentary: ${graded.backfilledSeasons.join(", ")}`,
      );
    }
    results.push({
      name: "draft grades",
      ok: true,
      detail: `${graded.generated} generated, ${graded.revisited} revisited across ${graded.seasons} season(s)`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`FAILED: ${detail}`);
    results.push({ name: "draft grades", ok: false, detail });
  }

  if (skipAI || !isAIConfigured()) {
    const why = skipAI ? "--skip-ai was passed" : "no OPENAI_API_KEY is configured";
    console.log(`\nSkipping AI regeneration (${why}).`);
    console.log("Manager performance summaries and blurbs still reflect the pre-import numbers.");
    console.log("Run these once a key is available:");
    console.log("  npx tsx scripts/import/generate-manager-summaries.ts");
    console.log("  npx tsx scripts/ai/backfill-blurbs.ts");
  } else {
    // 3. Career-derived manager summaries.
    runScript("manager performance summaries", "scripts/import/generate-manager-summaries.ts");
    // 4. Cached commentary. Keyed by a hash of the verified inputs, so only
    // subjects whose numbers actually moved are rewritten.
    runScript(
      "cached AI commentary (power rankings, rivalries, trades)",
      "scripts/ai/backfill-blurbs.ts",
    );
  }

  console.log("\n=== summary ===");
  let failures = 0;
  for (const step of results) {
    console.log(`  ${step.ok ? "ok  " : "FAIL"} ${step.name}: ${step.detail}`);
    if (!step.ok) failures++;
  }
  if (failures > 0) {
    console.log(`\n${failures} step(s) failed.`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
