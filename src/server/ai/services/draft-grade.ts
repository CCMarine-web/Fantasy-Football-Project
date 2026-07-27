// Content service: draft report-card RATIONALE text.
//
// This module only produces the *prose* that justifies a draft grade — the
// judgmental, funny couple of sentences. The letter grade itself is derived
// deterministically by the repository (draft-grade-repository.ts) from outcome
// signals, so grades stay sensible even on the mock provider with no
// OPENAI_API_KEY. These functions never write to the database; the repository
// owns persistence (grades live in the DraftGrade table, not AIContentGeneration).

import { getAIProvider } from "../get-ai-provider";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const DRAFT_GRADE_PROMPT_VERSION = "draft-grade-v1";
export const DRAFT_REVISIT_PROMPT_VERSION = "draft-revisit-v1";

/** Structured facts the original draft-day rationale is written from. */
export interface DraftRationaleInput {
  seasonYear: number;
  managerName: string;
  teamName?: string;
  /** Human-readable derived letter, e.g. "B+". The AI justifies this grade; it does not choose it. */
  derivedGrade: string;
  totalPicks: number;
  keepers: number;
  rounds: number;
  /** One readable line per pick, e.g. "Round 1: Justin Jefferson (WR, MIN)". */
  picks: string[];
  /** 0-100 composite behind the letter, and where it placed in the room. */
  draftScore?: number;
  rankInLeague?: string;
  /** The measured factors, strongest first, e.g. "Starter quality 88/100 (avg starter pick 41.2)". */
  factorBreakdown?: string[];
  /** Stated when average draft position was unavailable for the season. */
  dataCaveat?: string;
}

/** Structured facts the revisited (post-season) rationale is written from. */
export interface DraftRevisitInput {
  seasonYear: number;
  managerName: string;
  teamName?: string;
  /** Original draft-day letter, e.g. "B+". */
  originalGrade: string;
  originalRationale?: string;
  /** Newly derived post-season letter, e.g. "A-". */
  revisitedGrade: string;
  finish: {
    record: string;
    pointsFor?: number;
    regularSeasonRank?: number | null;
    finalRank?: number | null;
    madePlayoffs: boolean;
    isChampion: boolean;
  };
}

/** Plain text + which provider produced it — no DB writes here. */
export interface DraftRationaleResult {
  text: string;
  providerName: string;
}

const GRADE_SYSTEM_PROMPT = `You are the draft analyst for "The Rat Trap", a fantasy football league's own newspaper, writing snap draft-day report cards.

You are given a manager's picks, the measured factor scores behind the grade, and the letter the paper has ALREADY assigned. Write 3-5 sentences that justify THAT grade — never invent or announce a different letter.

Critical: this grade judges the DRAFT ONLY, using what was knowable on draft day. Never mention how the season turned out, the final standings, championships, playoff results, waiver pickups or trades — none of that is an input and referencing it would be wrong. Talk about the picks: reaches, steals, positional runs, roster balance, thin spots, keepers.

If told average draft position was unavailable, do not claim a pick beat or missed "ADP" — reason from where players went relative to the rest of the room instead.

Write plain prose, not bullet points or JSON, and do not restate the pick list mechanically.`;

const REVISIT_SYSTEM_PROMPT = `You are the draft analyst for "The Rat Trap", revisiting a draft grade now that the season is over.

You are given the original draft-day grade and the manager's ACTUAL finish, plus the paper's new "revisited" letter. Write 3-5 sentences contrasting the draft-day take with how the season played out — vindication, regression, or a slow-motion disaster.

Be explicit that this is hindsight and does not replace the original grade. A good draft that ran into injuries or bad luck was still a good draft; a poor draft rescued by waivers and trades was still a poor draft. Say so where the facts support it.

Justify the revisited grade you were given; do not announce a different letter. Write plain prose, not bullet points or JSON.`;

export async function generateDraftRationale(
  input: DraftRationaleInput,
  safeguards: ContentSafeguards
): Promise<DraftRationaleResult> {
  const systemPrompt = buildSystemPrompt(GRADE_SYSTEM_PROMPT, safeguards);
  const userPrompt = `Structured draft data (grade "${input.derivedGrade}" already assigned — justify it):\n${formatStructuredInput(input)}`;

  const result = await getAIProvider().generate({
    promptVersion: DRAFT_GRADE_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  return { text: result.text, providerName: result.providerName };
}

export async function generateDraftRevisitRationale(
  input: DraftRevisitInput,
  safeguards: ContentSafeguards
): Promise<DraftRationaleResult> {
  const systemPrompt = buildSystemPrompt(REVISIT_SYSTEM_PROMPT, safeguards);
  const userPrompt = `Structured draft-vs-results data (revisited grade "${input.revisitedGrade}" already assigned — justify it):\n${formatStructuredInput(input)}`;

  const result = await getAIProvider().generate({
    promptVersion: DRAFT_REVISIT_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  return { text: result.text, providerName: result.providerName };
}
