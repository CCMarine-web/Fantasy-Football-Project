import { getEnv, isAIConfigured } from "@/lib/env";
import { buildVoicedSystemPrompt, type VoiceContentType } from "@/server/ai/voice";
import { generateVoiced } from "@/server/ai/voiced-generate";
import type { ContentSafeguards } from "@/server/ai/types";
import { findEditorialProblems, rewriteWithoutProblemsInstruction } from "@/server/ai/editorial-guards";
import { buildLeagueVoiceGuidance } from "@/server/ai/research-packet";
import { avoidRepetitionInstruction, getRecentlyUsedMaterial } from "@/server/ai/content-memory";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { getBlurbs, putBlurb } from "@/server/ai/blurb-cache";
import type { AIUsage } from "@/server/ai/types";
import { FACTOR_META } from "@/server/stats/weekly-power-rankings";
import { tradeVerdictKey, type TradeTribunalView } from "@/server/repositories/trade-tribunal-repository";
import { powerBlurbHash, type PowerRankingView, type PowerRankingsView } from "@/server/repositories/power-rankings-repository";

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
  safeguards: ContentSafeguards;
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
    safeguards,
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
export async function writeBlurb(
  ctx: BlurbContext,
  userPrompt: string,
  maxTokens: number,
  contentType: VoiceContentType,
): Promise<WrittenBlurb | null> {
  const base = [ctx.voice, ctx.avoid, userPrompt].filter(Boolean).join("\n\n");
  const systemPrompt = buildVoicedSystemPrompt(SITE_BLURB_SYSTEM, contentType, ctx.safeguards);
  let prompt = base;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // generateVoiced holds the unhinged voice to the verified numbers.
    const result = await generateVoiced({
      promptVersion: "site-blurb-v2",
      systemPrompt,
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

// ── Power-ranking blurbs ─────────────────────────────────────────────────────

/**
 * The prompt for one team's ranking blurb: only the factors that actually
 * carried weight this run go in the packet, so the copy cannot praise a draft
 * that has not happened or keeper value that was never recorded.
 */
export function powerBlurbPrompt(data: PowerRankingsView, r: PowerRankingView): string {
  const BASIS: Record<PowerRankingsView["mode"], string> = {
    MANAGER_BASELINE:
      "before the draft — this ranks MANAGERS on previous seasons only. There is no roster, no draft board and no keeper information for this year, so nothing about this year's team can be characterised",
    PRESEASON: "after the draft, before week 1 — this ranks the freshly drafted rosters. No games have been played this season",
    IN_SEASON: `through week ${data.throughWeek} of live results`,
  };
  const usedFactors = r.factors.filter((f) => f.weight > 0);
  const inSeason = data.mode === "IN_SEASON";
  const facts = {
    season: data.seasonYear,
    basis: BASIS[data.mode],
    rank: r.rank,
    of: data.rows.length,
    previousRank: r.previousRank,
    team: r.teamName,
    manager: r.managerName,
    powerScore: r.score,
    pointsPerGame: r.weightedPointsPerGame,
    // Before week 1 these are zeros, which read as a real 0-0 rather than "not yet".
    ...(inSeason
      ? {
          allPlay: `${r.allPlayWins}-${r.allPlayLosses}`,
          expectedWins: r.expectedWins,
          actualRecordForContextOnly: r.record,
          lineupEfficiencyPct: r.lineupEfficiency,
        }
      : {}),
    factorsThatDecidedThisRanking: usedFactors.map((f) => ({
      factor: f.label,
      shareOfScore: `${Math.round(f.weight * 100)}%`,
      // League-normalised, and higher always helped the ranking. Without the
      // meaning a writer read a soft schedule ("102.4 allowed") as "brutal".
      scoreOutOf100: f.value,
      meaning: FACTOR_META[f.key].description,
      detail: f.raw,
    })),
    strongest: [...usedFactors].sort((a, b) => b.value - a.value)[0]?.label ?? null,
    weakest: [...usedFactors].sort((a, b) => a.value - b.value)[0]?.label ?? null,
  };
  return [
    `Write ONE sentence (max 32 words) about this team's standing in the ${data.seasonYear} rankings.`,
    ``,
    `These rankings measure team QUALITY, not results: win-loss record is NOT an input. Do not claim the ranking is based on wins, championships or playoff finish, and do not restate the record as if it drove the rating.`,
    ``,
    `Each factor's scoreOutOf100 compares this team with the rest of the league: 100 is the best in the league on that factor, 0 the worst, and a higher score always helped the ranking. Read "meaning" before describing a factor.`,
    ``,
    `"factorsThatDecidedThisRanking" is the COMPLETE list of what went into this number. You may only characterise factors on that list. A factor that is not listed was not measured and carried no weight — say nothing about it, in any direction. In particular: never mention keepers, keeper value, a draft, draft picks, draft capital or roster construction unless a factor about it appears in that list.`,
    ``,
    `The "basis" field says what stage of the season this is. Do not imply games have been played when they have not.`,
    ``,
    `Verified facts:`,
    JSON.stringify(facts, null, 2),
  ].join("\n");
}

/**
 * The weekly part of the power rankings' commentary: one blurb per team,
 * written from this week's numbers, in the active voice. A blurb whose numbers
 * have not changed is left alone.
 */
export async function refreshPowerRankingBlurbs(data: PowerRankingsView | null): Promise<{ written: number; unchanged: number }> {
  if (!data || data.rows.length === 0 || !isAIConfigured()) return { written: 0, unchanged: 0 };
  const subjects = data.rows.map((r) => ({ subjectKey: `${data.seasonYear}:${r.fantasyTeamId}`, inputHash: powerBlurbHash(r, data.throughWeek, data.mode) }));
  const stored = await getBlurbs("POWER_RANKING", subjects);
  let ctx: BlurbContext | null = null;
  let written = 0;
  let unchanged = 0;
  for (const [i, r] of data.rows.entries()) {
    const { subjectKey, inputHash } = subjects[i];
    const current = stored.get(subjectKey);
    if (current && !current.stale) {
      unchanged += 1;
      continue;
    }
    ctx ??= await buildBlurbContext();
    const out = await writeBlurb(ctx, powerBlurbPrompt(data, r), 2200, "power-ranking").catch(() => null);
    if (out && (await putBlurb({ kind: "POWER_RANKING", subjectKey, inputHash, text: out.text, providerName: out.provider, model: out.model }))) {
      written += 1;
    }
  }
  return { written, unchanged };
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
    const out = await writeBlurb(ctx, tradeVerdictPrompt(t), 2200, "trade-verdict").catch(() => null);
    if (!out) continue;
    if (
      await putBlurb({ kind: "TRADE_VERDICT", subjectKey: t.transactionId, inputHash: tradeVerdictKey(t), text: out.text, providerName: out.provider, model: out.model })
    ) {
      written += 1;
    }
  }
  return { written, unchanged };
}
