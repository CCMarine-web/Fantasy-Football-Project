import "../lib/load-env";
import { prisma } from "@/lib/db";
import { isAIConfigured } from "@/lib/env";
import { regenerateManagerPerformanceSummary } from "@/server/repositories/manager-repository";

/**
 * Rewrites every manager's saved description at full length.
 *
 *   npx tsx scripts/ai/regenerate-manager-profiles.ts --dry-run
 *   npx tsx scripts/ai/regenerate-manager-profiles.ts
 *
 * The old summaries were 2-4 sentences written from a thin packet (career
 * record, titles, best/worst finish). The packet now carries the full verified
 * career — both platform eras, every season line, scoring trend, all-play
 * record, head-to-head history, draft and transaction tendencies, and the
 * private communication profile as tone guidance — and the prompt asks for
 * several paragraphs. Expect roughly 3-4x the previous length.
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(`=== manager profiles ===${dryRun ? " (DRY RUN)" : ""}`);
  if (!isAIConfigured() && !dryRun) {
    console.log("No OPENAI_API_KEY — placeholder text is never saved. Nothing to do.");
    process.exitCode = 2;
    return;
  }

  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    select: { id: true, displayName: true, performanceSummary: { select: { summary: true } } },
    orderBy: { displayName: "asc" },
  });

  let rewritten = 0;
  for (const manager of managers) {
    const beforeWords = manager.performanceSummary?.summary.split(/\s+/).length ?? 0;

    if (dryRun) {
      console.log(`  ${manager.displayName.padEnd(22)} currently ${beforeWords} words`);
      continue;
    }

    const result = await regenerateManagerPerformanceSummary(manager.id);
    if (!result) {
      console.log(`  ${manager.displayName.padEnd(22)} no history — skipped`);
      continue;
    }
    if (result.isMock) {
      console.log(`  ${manager.displayName.padEnd(22)} mock output — not saved`);
      continue;
    }

    const afterWords = result.text.split(/\s+/).length;
    const paragraphs = result.text.split(/\n\s*\n/).length;
    console.log(
      `  ${manager.displayName.padEnd(22)} ${beforeWords} -> ${afterWords} words (${paragraphs} paragraphs, ${(afterWords / Math.max(1, beforeWords)).toFixed(1)}x)`,
    );
    rewritten++;
  }

  console.log(dryRun ? "\nDRY RUN — nothing written." : `\nRewrote ${rewritten} profile(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
