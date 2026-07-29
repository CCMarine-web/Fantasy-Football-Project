// One-line rivalry characterization. Render-time helper (no DB logging), like
// power-ranking-blurb: cheap with the mock provider; the weekly cron should
// pre-generate with a real provider instead of calling per request.

import { getAIProvider } from "../get-ai-provider";
import { buildSystemPrompt } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const RIVALRY_BLURB_PROMPT_VERSION = "rivalry-blurb-v1";

export interface RivalryBlurbInput {
  managerA: string;
  managerB: string;
  record: string; // "A leads 6-4"
  gamesPlayed: number;
  playoffMeetings: number;
  closestMargin: number;
  biggestMargin: number;
  currentStreak: string; // e.g. "A has won 3 straight"
}

const SYSTEM_PROMPT = `You are the staff writer for "The Rat Trap", a fantasy football league's own newspaper. Given the facts of a rivalry between two managers, write ONE punchy sentence (max ~30 words) with attitude that characterizes it — is it lopsided, a dead heat, a playoff grudge, a blowout festival? Plain prose, no JSON, no preamble.

RULES
- Use only the supplied numbers. "Playoff meetings" counts championship-bracket games only; if it is zero, these two have never met in the playoffs, whatever else the meeting count says.
- Never mention a toilet bowl, a consolation bracket or a placement game. Those results are not in your input and anything you say about them is invented.`;

export async function generateRivalryBlurb(
  input: RivalryBlurbInput,
  safeguards: ContentSafeguards,
): Promise<string> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = [
    `${input.managerA} vs ${input.managerB}: ${input.record} over ${input.gamesPlayed} meetings (${input.playoffMeetings} in the playoffs).`,
    `Closest game decided by ${input.closestMargin} pts; biggest blowout ${input.biggestMargin} pts.`,
    `Current streak: ${input.currentStreak}.`,
  ].join("\n");

  const result = await getAIProvider().generate({
    promptVersion: RIVALRY_BLURB_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
    maxOutputTokens: 80,
  });
  return result.text.trim();
}
