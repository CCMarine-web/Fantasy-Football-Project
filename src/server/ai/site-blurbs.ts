import { getEnv, isAIConfigured } from "@/lib/env";
import { getAIProvider } from "@/server/ai/get-ai-provider";
import { buildSystemPrompt } from "@/server/ai/prompt-helpers";
import { findEditorialProblems, rewriteWithoutProblemsInstruction } from "@/server/ai/editorial-guards";
import { buildLeagueVoiceGuidance } from "@/server/ai/research-packet";
import { avoidRepetitionInstruction, getRecentlyUsedMaterial } from "@/server/ai/content-memory";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { getBlurbs, putBlurb } from "@/server/ai/blurb-cache";
import type { AIUsage } from "@/server/ai/types";
import { tradeVerdictKey, type TradeTribunalView } from "@/server/repositories/trade-tribunal-repository";

/**
 * Short site copy — power-ranking blurbs, rivalry one-liners, trade verdicts —
 * written from verified numbers and cached in AIBlurbCache.
 *
 * This lived only in scripts/ai/backfill-blurbs.ts, run by hand. The weekly
 * refresh now needs some of it too (current-season trade verdicts are
 * provisional and follow the hindsight winner), so the writer and the prompts
 * live here and the script calls them.
 */

export const SITE_BLURB_SYSTEM = `You are a staff writer for "The Rat Trap", a fantasy-football league newspaper. Write with personality — dry, needling, confident — but NEVER invent a statistic, event, quote, or storyline. You may only characterise the numbers you are given. If the numbers are thin, be brief rather than padding with invention. Do not mention that you are an AI, do not mention prompts or data sources, and do not quote anyone. Output plain prose only: no markdown, no headings, no quotation marks around the whole response.`;

export interface BlurbContext {
  systemBase: string;
  voice: string;
  avoid: string;
  model: string;
}

export interface WrittenBlurb {
  text: string;
  provider: string;
  model: string;
  usage?: AIUsage;
}

/** Safeguards, league voice and recently used material — built once per run. */
export async function buildBlurbContext(): Promise<BlurbContext> {
  const [safeguards, voice, used] = await Promise.all([
    getContentSafeguards(),
    buildLeagueVoiceGuidance(),
    getRecentlyUsedMaterial({ limit: 60 }),
  ]);
  return {
    systemBase: buildSystemPrompt(SITE_BLURB_SYSTEM, safeguards),
    voice,
    avoid: avoidRepetitionInstruction(used),
    model: getEnv().OPENAI_MODEL,
  };
}

/**
 * Generates one piece of copy, and refuses to hand back a draft with defects a
 * reader would see: the writer is shown its own offending phrase and asked
 * again; after three attempts the caller is told to skip rather than save.
 * Returns null for mock output (nothing is ever cached from it).
 */
export async function writeBlurb(ctx: BlurbContext, userPrompt: string, maxTokens: number): Promise<WrittenBlurb | null> {
  const base = [ctx.voice, ctx.avoid, userPrompt].filter(Boolean).join("\n\n");
  let prompt = base;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await getAIProvider().generate({
      promptVersion: "site-blurb-v2",
      systemPrompt: ctx.systemBase,
      userPrompt: prompt,
      humorLevel: 3,
      maxOutputTokens: maxTokens,
      reasoningEffort: "low",
      model: ctx.model,
    });
    if (result.providerName === "mock") return null;
    const text = result.text.trim();
    const problems = findEditorialProblems(text);
    if (problems.length === 0) return { text, provider: result.providerName, model: result.model, usage: result.usage };
    if (attempt === 2) return null;
    prompt = `${base}\n\n${rewriteWithoutProblemsInstruction(problems)}\n\nPrevious draft:\n${text}`;
  }
  return null;
}

// ── Trade verdicts ─────────────────────────────────────────────────────────

export function tradeVerdictPrompt(t: TradeTribunalView): string {
  /*
   * The verdict is written from position-relative value, not raw points. The
   * facts deliberately omit a points total for either side — quoting one
   * invites "he got 400 points and gave up 300", which is the comparison the
   * valuation exists to replace.
   */
  const facts = {
    season: t.seasonYear,
    week: t.week,
    provisional: t.provisional,
    sides: t.sides.map((s) => ({
      manager: s.managerName,
      acquired: s.acquired,
      valueAboveReplacement: s.value,
      players: s.players.map((p) => ({
        name: p.name,
        position: p.position,
        pointsPerGameAboveReplacement: p.ppgAboveReplacement,
        positionalPercentile: p.positionalPercentile,
        shareOfRemainingWeeksPlayed: p.availability,
        issue: p.note,
      })),
      assetsWithNoMarketPrice: s.unpricedAssets,
    })),
    differential: t.differential,
    verdictBand: t.lopsidedness,
    confidence: t.confidence,
    summary: t.hindsightSummary,
    inputsUnavailable: t.missingInputs,
  };
  return [
    "Write ONE sentence (max 34 words) delivering a verdict on this trade for the league's Trade Tribunal.",
    "",
    "Rules:",
    '- The verdict band in "verdictBand" is the judgement. Do not contradict it or invent a different winner.',
    '- If confidence is "NONE" or "LOW", say the evidence is thin rather than pronouncing.',
    '- If "provisional" is true, the season is still being played: this is a ruling so far, not a final one. Say so naturally ("so far", "for now").',
    "- Value is measured against what was freely available at each player's own position. Never compare the two sides on raw points, and never say one player outscored another as though that settled it.",
    '- Anything in "inputsUnavailable" is genuinely unknown. Do not speculate about it.',
    '- Write for a reader, not an analyst. No abbreviations or jargon — never "VOR", "VORP", "value above replacement", "differential", or a raw field name. Say it plainly: "got the better of", "came out well ahead", "barely moved the needle".',
    "- Do not open with \"Verdict:\", \"Trade Tribunal:\", or the band name in capitals. Just write the sentence.",
    "",
    "Verified facts:",
    JSON.stringify(facts, null, 2),
  ].join("\n");
}

/**
 * The weekly part of the Trade Tribunal: for every trade still provisional, or
 * whose season has just finished, write a verdict if the stored one was keyed
 * on a different winner (or finality). Historical verdicts are never touched.
 */
export async function refreshTradeVerdicts(trades: TradeTribunalView[]): Promise<{ written: number; unchanged: number }> {
  const inScope = trades.filter((t) => t.provisional || t.verdictStatus === "AWAITING_FINAL");
  if (inScope.length === 0 || !isAIConfigured()) return { written: 0, unchanged: inScope.length };

  const stored = await getBlurbs(
    "TRADE_VERDICT",
    inScope.map((t) => ({ subjectKey: t.transactionId, inputHash: tradeVerdictKey(t) })),
  );
  let ctx: BlurbContext | null = null;
  let written = 0;
  let unchanged = 0;
  for (const t of inScope) {
    const current = stored.get(t.transactionId);
    if (current && !current.stale) {
      unchanged += 1;
      continue;
    }
    ctx ??= await buildBlurbContext();
    const out = await writeBlurb(ctx, tradeVerdictPrompt(t), 2200);
    if (!out) continue;
    if (
      await putBlurb({ kind: "TRADE_VERDICT", subjectKey: t.transactionId, inputHash: tradeVerdictKey(t), text: out.text, providerName: out.provider, model: out.model })
    ) {
      written += 1;
    }
  }
  return { written, unchanged };
}
