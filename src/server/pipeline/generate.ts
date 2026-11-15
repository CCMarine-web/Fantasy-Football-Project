import { revalidateTag } from "next/cache";
import { isAIConfigured } from "@/lib/env";
import { CACHE_TAGS, clearProcessMemo } from "@/server/cache";
import type { LeagueClock } from "@/server/league-clock";
import { buildCatalog } from "@/server/text/catalog";
import { produceMany } from "@/server/text/engine";
import { classifySpecs } from "@/server/text/read";
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
 * The generate-text step.
 *
 * Every job does the same thing — build the catalog of texts that should
 * exist, and write the ones whose facts changed — because WHEN a text is due
 * is encoded in its facts (see server/text/catalog.ts): Tuesday's results move
 * the recaps, blurbs, awards and news; Thursday's projections create the
 * previews; a rivalry only moves when the pair meets. The daily job is
 * therefore a catch-up net that usually finds nothing to do.
 *
 * Runs until the time budget is nearly spent; anything left stays stale (its
 * fallback shows) and the next run picks it up.
 */
export async function runTextGeneration(ctx: TextGenerationContext): Promise<TextGenerationResult> {
  const useModel = !ctx.noModel && isAIConfigured();
  // The compute step just rewrote stored stats; drop cached reads so the
  // facts are built from what the pages will show after this run.
  for (const tag of Object.values(CACHE_TAGS)) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch {
      /* outside Next (CLI): cached() reads straight from the database anyway */
    }
  }

  clearProcessMemo();
  const catalog = await buildCatalog({ clock: ctx.clock });
  const classes = await classifySpecs(catalog);
  const todo = ctx.force ? catalog : [...classes.stale, ...classes.retry];
  if (todo.length === 0) {
    return {
      status: "SUCCESS",
      detail: `All ${catalog.length} texts are current (${classes.fallback.length} on their templated fallback).`,
      counts: { textsTotal: catalog.length, textsStale: 0, textsFallback: classes.fallback.length },
    };
  }

  const r = await produceMany(todo, {
    budgetMs: ctx.budgetMs,
    force: ctx.force,
    noModel: !useModel,
    concurrency: 6,
    onProgress: ctx.onProgress,
  });
  const after = await classifySpecs(catalog);
  const counts = {
    textsTotal: catalog.length,
    textsGenerated: r.generated,
    textsFallbackWritten: r.fallback,
    textsFailed: r.failed,
    textsStale: after.stale.length,
    textsFallback: after.fallback.length + after.retry.length,
  };
  const detail = `${catalog.length} texts in the catalog; ${todo.length} needed writing: ${r.generated} written by the model, ${r.fallback} on the templated fallback${r.failed ? `, ${r.failed} failed (${r.errors.join("; ")})` : ""}.${r.remaining ? ` ${r.remaining} left for the next run (time budget).` : ""}${useModel ? "" : " No AI provider: templated text only."} Stale now: ${after.stale.length}.`;
  return { status: r.failed || after.stale.length ? "PARTIAL" : "SUCCESS", detail, counts };
}
