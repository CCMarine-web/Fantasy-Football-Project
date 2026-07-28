// Content service: the polished, long-form season history article.
//
// The commissioner's own recaps were transcribed from photographs of typed
// pages and arrived fragmented — a bare year on its own line, then "RECAP",
// then "RECAP PART 2", then a sentence cut mid-clause where one image ended
// and the next began. Rendered verbatim they read as scanned notes, and the
// page put the year in the card title too, producing "2023 2023 Season".
//
// This service stitches those fragments into one continuous narrative and
// weaves in the verified record for that season. It preserves the
// commissioner's voice and meaning; it does not add events.

import { getAIProvider } from "../get-ai-provider";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const SEASON_ARTICLE_PROMPT_VERSION = "season-article-v1";

export interface SeasonArticleFacts {
  year: number;
  dataSource: string;
  teamCount: number;
  regularSeasonWeeks: number;
  champion: string | null;
  championTeam: string | null;
  runnerUp: string | null;
  thirdPlace: string | null;
  /** Best regular-season record, which is often not the champion. */
  regularSeasonLeader: string | null;
  regularSeasonLeaderRecord: string | null;
  highestScoringTeam: string | null;
  highestScoringPoints: number | null;
  lowestScoringTeam: string | null;
  lowestScoringPoints: number | null;
  /** Final standings, best to worst. */
  standings: {
    rank: number;
    manager: string;
    teamName: string;
    record: string;
    pointsFor: number;
  }[];
  /** Notable playoff games that season. */
  playoffResults: string[];
  /** Highest-scoring single week by any team. */
  bestWeek: string | null;
  /** Closest and biggest-margin games. */
  closestGame: string | null;
  biggestBlowout: string | null;
  /** Head-to-head meetings between declared rivals that season. */
  rivalryGames: string[];
  /** Draft headline for the season, if a draft is on record. */
  draftNote: string | null;
  /**
   * Trades made that season, with the Tribunal's verdict on each. Empty when
   * none are on record — which for an ESPN season means the platform does not
   * retain them, not that nobody traded.
   */
  trades: string[];
  /** The commissioner's own recap fragments, in order, labels already stripped. */
  commissionerFragments: string[];
  /** Things genuinely not on record for this season. */
  unavailable: string[];
}

export interface SeasonArticleResult {
  title: string;
  body: string;
  providerName: string;
  isMock: boolean;
}

const SYSTEM_PROMPT = `You are the staff writer for "The Rat Trap", a fantasy-football league's own newspaper, writing the definitive retrospective on one season.

YOUR SOURCE MATERIAL
1. "commissionerFragments" — the commissioner's own written recap, transcribed from typed pages and broken into pieces. Some fragments end mid-sentence because the original page ended there.
2. The verified record for that season: standings, champion, scoring, playoff results.

WHAT TO PRODUCE
One flowing article of FOUR to SIX paragraphs, roughly 350-500 words. Plain paragraphs separated by a blank line. No headings, no bullet points, no labels, no "RECAP" markers, no year stamp at the start — the page already shows the year.

HOW TO HANDLE THE FRAGMENTS
- Stitch them into continuous prose in their original order.
- Keep the commissioner's voice, jokes, nicknames and opinions. This is their story; you are editing, not replacing.
- Where a fragment breaks off mid-thought, complete the sentence ONLY if the verified facts make the ending unambiguous. If they do not, rephrase so the sentence closes cleanly without asserting anything new.
- Drop the structural debris: "RECAP", "RECAP PART 2", "PART 3", repeated year headings.
- Silently fix obvious transcription slips in league or team names when the verified record makes the correct name clear.

WEAVING IN THE RECORD
Fold the verified facts into the narrative where they support or complete the commissioner's account — who actually won, who led the regular season, the scoring extremes, how the playoffs went. Do not append them as a separate block of statistics. Numbers you cite must match the packet exactly.

TRADES
"trades" lists every trade on record for the season with the Tribunal's verdict on it. If there are any, at least one belongs in the article — a season in which someone was fleeced is not a season without notable trades. Use the verdict as given; do not re-judge a trade or invent a winner. If the list is empty, say nothing about trading at all unless "unavailable" explains why there is no record.

Write these as sentences. Never paste an entry verbatim: a line reading "Week 10: Blake Mire got Terry McLaurin (WR) and Khalil Shakir (WR); Michael Barkemeyer got Amon-Ra St. Brown (WR). Tribunal verdict: Highway Robbery." is a data dump with a label on it, not writing. Say who got fleeced and why it mattered.

POSTSEASON LANGUAGE
Round names in "playoffResults" are the brackets' own. A game named as consolation, a toilet bowl or a placement game is NOT a playoff game and never decides third place — the third-place game is in the championship bracket. Do not promote a consolation result into the playoff narrative, and do not call the championship bracket's third-place game a consolation final.

"bestWeek", "closestGame" and "biggestBlowout" are season-wide and each names its own week. Do not fold them into a sentence about the playoffs unless the week they name is one of the weeks in "playoffResults" — a one-point thriller in week 8 is not a playoff thriller.

HARD RULES
- Invent nothing. No events, no quotations, no trades, no controversies, no drama that is not in the source.
- If the commissioner refers to something the verified record cannot confirm (an unnamed manager, a disputed detail), report it as the commissioner told it without asserting it as fact, or leave it out.
- Anything in "unavailable" is genuinely not on record. Never imply it is known.
- Respect the safeguards.`;

const TITLE_PROMPT = `Write a short, punchy title for this season retrospective — 3 to 7 words, no year, no quotation marks, no colon-subtitle. It should capture the season's defining story. Reply with the title only.`;

export async function generateSeasonArticle(
  facts: SeasonArticleFacts,
  safeguards: ContentSafeguards,
): Promise<SeasonArticleResult> {
  const provider = getAIProvider();
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Season ${facts.year}. Write the retrospective.\n\n${formatStructuredInput(facts)}`;

  const body = await provider.generate({
    promptVersion: SEASON_ARTICLE_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  const titleResult = await provider.generate({
    promptVersion: `${SEASON_ARTICLE_PROMPT_VERSION}-title`,
    systemPrompt: buildSystemPrompt(TITLE_PROMPT, safeguards),
    userPrompt: `Season ${facts.year}.\n\nThe article:\n${body.text}`,
    humorLevel: safeguards.humorLevel,
  });

  const isMock = body.providerName === "mock";
  const title = titleResult.text
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\.$/, "")
    .slice(0, 80);

  return {
    title: title || `The ${facts.year} Season`,
    body: body.text.trim(),
    providerName: body.providerName,
    isMock,
  };
}
