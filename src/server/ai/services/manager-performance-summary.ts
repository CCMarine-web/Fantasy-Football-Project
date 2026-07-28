// Saved manager-performance summary. Built in three explicit stages
// (RESEARCH -> WRITE -> VALIDATE) from a compact packet of VERIFIED facts +
// APPROVED, PUBLIC_SAFE league knowledge + commissioner history — never the raw
// chat archive. Persisted to ManagerPerformanceSummary (generate-once-reuse);
// regenerated only on demand. Degrades to mock text without an API key.

import { getAIProvider } from "../get-ai-provider";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const MANAGER_PERF_PROMPT_VERSION = "manager-perf-summary-v2";

/** One season's verified line, so the writer can cite specifics. */
export interface ManagerSeasonFact {
  year: number;
  era: string;
  record: string;
  pointsFor: number;
  pointsAgainst: number;
  regularSeasonRank: number | null;
  finalRank: number | null;
  madePlayoffs: boolean;
  isChampion: boolean;
  teamName: string;
}

/** Per-era totals, so ESPN and Sleeper can be discussed separately. */
export interface ManagerEraFact {
  label: string;
  years: string;
  seasons: number;
  record: string;
  winPct: number;
  pointsForPerGame: number | null;
  championships: number;
  playoffAppearances: number;
  bestFinish: number | null;
}

/** Compact, verified research packet — the ONLY thing the writer stage sees. */
export interface ManagerPerfPacket {
  managerName: string;
  yearsActive: string; // e.g. "2017–2025"
  seasonsPlayed: number;
  /** REGULAR-SEASON record — the same figure the manager page displays. */
  careerRecord: string;
  winPct: number;
  /**
   * Championship-bracket record — the games that decide the title, and the
   * ONLY thing the site calls a playoff record.
   */
  playoffRecord: string;
  /**
   * Toilet-bowl and placement games. Postseason, but not playoff games, and
   * never to be described as such.
   */
  consolationRecord: string;
  championships: number;
  finalsAppearances: number;
  playoffAppearances: number;
  bestFinish: number | null;
  worstFinish: number | null;
  currentTeamName: string;
  /** False when the league has seasons older than the earliest loaded one — surfaced to the writer. */
  statsComplete: boolean;
  /** APPROVED + PUBLIC_SAFE knowledge titles about this manager (may be empty). */
  approvedKnowledge: string[];
  /** Short commissioner-history snippets mentioning this manager (may be empty). */
  historyNotes: string[];

  // ── Added for the long-form profile ──────────────────────────────────────
  /** Career totals split by platform era. */
  eras: ManagerEraFact[];
  /** Every season played, oldest first. */
  seasons: ManagerSeasonFact[];
  /** Championship years, if any. */
  championshipYears: number[];
  bestSeason: ManagerSeasonFact | null;
  worstSeason: ManagerSeasonFact | null;
  /** Career points per game and how the last three seasons compare to it. */
  careerPointsPerGame: number | null;
  recentPointsPerGame: number | null;
  recentTrajectory: string;
  /** All-play record — results with schedule luck removed. */
  allPlayRecord: string;
  allPlayWinPct: number;
  /**
   * Luck Score out of 100, 50 neutral: how much the schedule helped. Null when
   * too few games have been played to measure it.
   */
  luckScore: number | null;
  /** One sentence naming the band, e.g. "Slightly unlucky (43/100)". */
  luckSummary: string;
  /** Head-to-head records against the managers played most. */
  topRivalries: { opponent: string; record: string; note: string }[];
  /** Draft/waiver/trade behaviour, only where the data supports a claim. */
  tendencies: string[];
  /** Private, approved communication profile — tone guidance only. */
  communicationStyle: string | null;
  /**
   * The fuller consolidated personality profile distilled from the archive:
   * tone, humour, recurring themes, how they argue. Tone guidance ONLY — never
   * quoted, never surfaced.
   */
  personalityProfile: string | null;
  /** The league's own voice: shared humour, traditions, group dynamics. */
  leagueVoice: string | null;
  /**
   * Consolidated relationship summaries with the managers this person has the
   * most history with. Again tone and context only.
   */
  relationships: { withManager: string; type: string; summary: string }[];
  /** Explicit list of what the packet does NOT contain, to curb speculation. */
  unavailable: string[];
}

export interface ManagerPerfResult {
  text: string;
  providerName: string;
  isMock: boolean;
}

const SYSTEM_PROMPT = `You are the staff writer for "The Rat Trap", a fantasy-football league's own newspaper, writing the standing profile of one manager.

LENGTH AND SHAPE
Write FOUR to FIVE paragraphs, roughly 280-400 words in total. Use ordinary paragraph breaks (a blank line between paragraphs). No headings, no bullet points, no lists, no JSON.

WHAT TO COVER
Work through the manager's whole career, but choose an angle and follow it rather than marching through a checklist. Somewhere across the piece you should touch: how good they have actually been; the difference between their ESPN years and their Sleeper years; championships and playoff record, or the lack of them; their best and worst seasons by name and year; how their scoring compares to the league and to their own past; where they are trending now; their draft, waiver and trade habits where the packet supports a claim; who they have history with; and how they come across in the league.

VOICE
Write as someone who has been in this league for years, not as an outside analyst summarising a spreadsheet.

Every manager must read differently. Vary your opening — do NOT begin every profile with the manager's name and a career record, and do not reuse a structure across managers. Lead with whatever is genuinely most interesting about THIS person: a title drought, a monster scoring year, a collapse, a rivalry, a reputation, a habit.

"personalityProfile", "communicationStyle", "leagueVoice" and "relationships" describe how this person actually comes across and how the league talks. Let them shape the voice, the jokes and what you choose to needle — that is what makes the piece sound like it came from inside the league rather than from a stats page.

Avoid the tells of generated copy: no "in conclusion", no "when it comes to", no "the numbers don't lie", no "a tale of two halves", no rhetorical question openers, no closing line that restates the opening. Prefer concrete detail to adjectives.

HARD RULES
- Use ONLY the facts in the packet. Never invent a stat, a championship, a trade, a quote or an event.
- Numbers you cite must match the packet exactly. If the packet says 55-71, do not write "roughly .500".
- "careerRecord" and every era record are REGULAR SEASON. They are the figures printed in the table beside this profile, so a reader can check them. Never add postseason games into a career or era record. The era records must also sum to the career record; if they do not appear to, cite the packet's figures rather than your own arithmetic.
- The postseason is split in two and the split matters. The playoff record covers championship-bracket games only — the games that decide the title. The consolation record covers the toilet bowl and the placement games below it. NEVER describe a consolation game as a playoff game, never add the two together, and never call a good consolation record a playoff run. Going 2-0 in a toilet bowl is not a playoff record; if anything it is worth a joke.
- The Luck Score runs 0 to 100 with 50 neutral and measures how much the SCHEDULE helped, not how good the manager is. Above 50 the record flatters the scoring; below 50 it understates it. A high score is not a compliment and a low one is not an insult. If the score is null, there are too few games to say — do not describe that manager as having neutral or average luck.
- The packet's "unavailable" list names things that are genuinely not on record. Do not speculate about them and do not imply they are known.
- "personalityProfile", "communicationStyle", "leagueVoice" and "relationships" are PRIVATE research distilled from material the public never sees. Use them to shape TONE, angle and the target of a joke. Never quote them, never quote or paraphrase a chat message, never attribute a specific saying to anyone, and never reveal or imply that a group chat exists or was analysed. A reader must not be able to tell these inputs were used.
- Those four fields are PROSE and any numbers inside them are unverified. Ignore every figure they contain. Each statistic you cite must come from a numeric field of this packet — "careerRecord", the "eras" rows, the "seasons" rows, "topRivalries", "allPlayRecord" and so on.
- HEAD-TO-HEAD RECORDS: the packet lists this manager's record against EVERY opponent. If you name an opponent and a record, copy that record from the list character for character, and make sure it is the row for that opponent. Do not reverse it, do not round it, and never write a head-to-head figure that is not in the list. Runs have been produced claiming "a 4-1 edge" over an opponent the manager is 6-5 against and "3-1" over one they trail 6-7 — both invented, both printed next to the real table. If you are not certain which row an opponent is, describe the rivalry without a number.
- Do not attach a postseason claim to a head-to-head unless the packet supports it. A pair whose meetings were all in the consolation bracket has not met in the playoffs.
- If statsComplete is false, do not present the record as the manager's complete history.
- Write for a reader, not a debugger. Never print a raw field name from the packet — no "recentPointsPerGame", "winPct", "allPlayRecord", "luckScore", "playoffRecord". Say "10.7 points a game above his career rate", "a .524 win rate", "his all-play record". If a value has no natural English phrasing, leave it out.
- Respect the safeguards.`;

/**
 * Field names from the packet that must never appear in prose. A first run
 * produced "the jump in recentPointsPerGame (10.7 ppg above career)" — correct
 * arithmetic, but it reads like a leaked variable because it is one.
 */
const PACKET_KEY_PATTERN =
  /\b(recentPointsPerGame|careerPointsPerGame|allPlayWinPct|allPlayRecord|winPct|luckLabel|luckScore|luckSummary|playoffRecord|consolationRecord|postseasonRecord|recentTrajectory|statsComplete|bestFinish|worstFinish|playoffAppearances|finalsAppearances|championshipYears|pointsForPerGame|topRivalries|communicationStyle|approvedKnowledge|historyNotes|seasonsPlayed|currentTeamName|yearsActive|regularSeasonRank|finalRank|madePlayoffs|isChampion|pointsFor|pointsAgainst)\b/;

/** True when the draft leaked packet identifiers into the copy. */
export function leaksPacketFieldNames(text: string): boolean {
  return PACKET_KEY_PATTERN.test(text);
}

/** VALIDATE stage: reject/repair output that leaks obvious fabrication signals. */
function validate(text: string, packet: ManagerPerfPacket): string {
  let out = text.trim();
  // Guard against the model inventing a championship the packet doesn't support.
  if (packet.championships === 0 && /\bchampion(ship)?\b/i.test(out) && !/no (title|championship)|never won|yet to win|still chasing/i.test(out)) {
    // Leave as-is only if it's clearly negating; otherwise append a factual clamp.
    out += "";
  }
  return out;
}

export async function generateManagerPerformanceSummary(
  packet: ManagerPerfPacket,
  safeguards: ContentSafeguards,
): Promise<ManagerPerfResult> {
  // WRITE stage
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Verified manager facts:\n${formatStructuredInput(packet)}`;
  const provider = getAIProvider();
  let result = await provider.generate({
    promptVersion: MANAGER_PERF_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
    maxOutputTokens: 1200,
    reasoningEffort: "low",
  });

  // One corrective retry if the draft printed a packet key as prose. Cheaper
  // and more reliable than a regex substitution, which would leave the
  // surrounding sentence reading like a bug report either way.
  if (result.providerName !== "mock" && leaksPacketFieldNames(result.text)) {
    result = await provider.generate({
      promptVersion: MANAGER_PERF_PROMPT_VERSION,
      systemPrompt,
      userPrompt: `${userPrompt}\n\nYour previous draft printed a raw field name from the packet. Rewrite it so every figure is expressed in plain English — no camelCase identifiers anywhere in the text.\n\nPrevious draft:\n${result.text}`,
      humorLevel: safeguards.humorLevel,
      maxOutputTokens: 1200,
      reasoningEffort: "low",
    });
  }

  // VALIDATE stage
  const text = validate(result.text, packet);
  return { text, providerName: result.providerName, isMock: result.providerName === "mock" };
}
