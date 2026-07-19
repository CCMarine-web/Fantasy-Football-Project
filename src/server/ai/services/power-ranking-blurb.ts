// Per-team power-ranking blurb. Unlike generatePowerRankings (which writes one
// commentary for the whole list and logs it), this returns a single team's
// blurb as plain text WITHOUT logging — it's a render-time helper meant to be
// called once per team, so it must stay cheap and side-effect-free. With the
// mock provider it's instant; with a real provider the weekly cron should
// pre-generate and persist instead of calling this per request.

import { getAIProvider } from "../get-ai-provider";
import { buildSystemPrompt } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const POWER_RANKING_BLURB_PROMPT_VERSION = "power-ranking-blurb-v1";

export interface PowerRankingBlurbInput {
  rank: number;
  previousRank: number | null;
  teamName: string;
  managerName: string;
  record: string;
  powerScore: number;
  topFactor: string; // e.g. "elite all-play record", "hottest team lately"
  weakestFactor: string; // e.g. "inconsistent scoring"
}

const SYSTEM_PROMPT = `You are the staff writer for "The Rat Trap", a fantasy football league's own newspaper, writing power-ranking blurbs. Given one team's rank and stat highlights, write ONE punchy sentence (max ~30 words) with attitude that explains why they're ranked where they are. Reference their strongest factor and needle them about their weakest. Plain prose, no JSON, no preamble.`;

export async function generatePowerRankingBlurb(
  input: PowerRankingBlurbInput,
  safeguards: ContentSafeguards,
): Promise<string> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const movement =
    input.previousRank == null
      ? "new to the rankings"
      : input.previousRank > input.rank
        ? `up ${input.previousRank - input.rank} from last week`
        : input.previousRank < input.rank
          ? `down ${input.rank - input.previousRank} from last week`
          : "holding steady";
  const userPrompt = [
    `Rank #${input.rank} (${movement})`,
    `Team: ${input.teamName} (${input.managerName}), record ${input.record}, power score ${input.powerScore}/100.`,
    `Biggest strength: ${input.topFactor}. Biggest weakness: ${input.weakestFactor}.`,
  ].join("\n");

  const result = await getAIProvider().generate({
    promptVersion: POWER_RANKING_BLURB_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
    maxOutputTokens: 80,
  });
  return result.text.trim();
}
