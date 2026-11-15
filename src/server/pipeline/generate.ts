import { isAIConfigured } from "@/lib/env";
import type { LeagueClock } from "@/server/league-clock";
import { generateWeeklyContent } from "@/server/ai/weekly-pipeline";
import { refreshPowerRankingBlurbs, refreshTradeVerdicts } from "@/server/ai/site-blurbs";
import { computePowerRankings } from "@/server/repositories/power-rankings-repository";
import { computeTradeTribunal } from "@/server/repositories/trade-tribunal-repository";
import type { PipelineJob, StepStatus } from "./run";

export interface TextGenerationContext {
  job: PipelineJob;
  clock: LeagueClock | null;
  weekOverride?: number;
  budgetMs: number;
  force: boolean;
  noModel: boolean;
  onProgress?: () => Promise<void>;
}

export interface TextGenerationResult {
  status: StepStatus;
  detail: string;
  counts: Record<string, number>;
}

/**
 * The generate-text step. Which texts are due depends on the job (see
 * run.ts); the daily job only catches up stale text.
 */
export async function runTextGeneration(ctx: TextGenerationContext): Promise<TextGenerationResult> {
  if (!isAIConfigured() && !ctx.noModel) {
    return { status: "SKIPPED", detail: "No AI provider key is set; nothing was written.", counts: {} };
  }
  const inSeason = ctx.clock?.phase === "REGULAR_SEASON" || ctx.clock?.phase === "PLAYOFFS";
  if (!inSeason || ctx.job === "daily") {
    return { status: "SKIPPED", detail: "Nothing is due on this job.", counts: {} };
  }
  const result = await generateWeeklyContent({
    sync: false,
    recapWeek: ctx.weekOverride,
    previewWeek: ctx.job === "thursday" ? (ctx.clock?.currentWeek ?? undefined) : undefined,
  });
  let detail = `${result.recapsGenerated} recap(s), ${result.previewsGenerated} preview(s).`;
  if (ctx.job === "weekly") {
    const verdicts = await refreshTradeVerdicts(await computeTradeTribunal());
    const blurbs = await refreshPowerRankingBlurbs(await computePowerRankings());
    detail += ` Trade verdicts rewritten: ${verdicts.written}. Power-ranking blurbs: ${blurbs.written}.`;
  }
  return {
    status: "SUCCESS",
    detail,
    counts: { textsGenerated: result.recapsGenerated + result.previewsGenerated },
  };
}
