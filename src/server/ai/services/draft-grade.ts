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

/**
 * Structured facts the revisited rationale is written from.
 *
 * Note what is NOT here: record, playoff berth, final placing, championship.
 * The revisited grade measures what the drafted players produced, so the writer
 * is not given season outcomes it could mistake for the reason for the grade.
 */
export interface DraftRevisitInput {
  seasonYear: number;
  managerName: string;
  /** Original draft-day letter, e.g. "B+". */
  originalGrade: string;
  originalRationale?: string;
  /** Newly derived hindsight letter, e.g. "A-". */
  revisitedGrade: string;
  /** 0-100 draft-return composite, and where it placed in the room. */
  returnScore: number;
  returnRank: string;
  /** Measured return factors, strongest first. */
  factorBreakdown: string[];
  /** The selections that most beat their slot. */
  bestPicks: string[];
  /** The selections that most fell short, with games played for context. */
  worstPicks: string[];
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

WHAT THIS GRADE MEASURES
Only what the DRAFTED PLAYERS went on to produce, per game, against the slot each was taken at. It is not a grade for the season. Wins, losses, playoff berths, final placings and championships are NOT inputs and are not in your packet — never claim or imply the grade reflects them, and never mention a title or a finish as the reason for it.

WHAT TO WRITE
3-5 sentences contrasting the draft-day read with what the picks actually returned. Name the specific selections in the packet: the ones that beat their slot, the ones that did not. Say plainly that this is hindsight and does not replace the original grade.

FAIRNESS
Production is measured per game, so a player who was excellent before getting hurt still counts as an excellent pick — if a pick's games-played figure is low, treat that as bad luck rather than a bad decision, and say so. Equally, a manager who rescued a weak draft through waivers or trades gets no credit here, because none of those players are in this measure.

Justify the revisited letter you were given; do not announce a different one. Write plain prose, not bullet points or JSON.`;

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
    // A two-sentence rationale does not need deep reasoning, and left unset the
    // provider was spending minutes per call: regenerating all 88 grades was on
    // course for eight hours. Bounded here to keep a full regeneration to
    // something a person will actually wait for.
    reasoningEffort: "low",
    maxOutputTokens: 900,
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
    // A two-sentence rationale does not need deep reasoning, and left unset the
    // provider was spending minutes per call: regenerating all 88 grades was on
    // course for eight hours. Bounded here to keep a full regeneration to
    // something a person will actually wait for.
    reasoningEffort: "low",
    maxOutputTokens: 900,
  });

  return { text: result.text, providerName: result.providerName };
}
