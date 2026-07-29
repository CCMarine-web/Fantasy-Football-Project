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
import { findEditorialProblems, rewriteWithoutProblemsInstruction } from "../editorial-guards";
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
  /**
   * Bottom of the REGULAR-SEASON standings — the league's only definition of
   * last place. Not the consolation-bracket loser, who is frequently somebody
   * else entirely.
   */
  lastPlace: string | null;
  lastPlaceRecord: string | null;
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
One flowing article of THREE to FOUR paragraphs, between 330 and 380 words — aim for the middle of that range, and do not go under 330. Plain paragraphs separated by a blank line. No headings, no bullet points, no labels, no "RECAP" markers, no year stamp at the start — the page already shows the year.

BE TIGHT
The article sits directly above the season's full standings table, its playoff results and its trade list, so anything the reader can already see does not need restating. Do not walk the standings from first to last. Do not set the scene before starting — open on the season's actual story. Do not close by summarising what you just said. Every sentence should carry a fact, a judgement or a joke; cut any that only carries transition.

WHAT MUST SURVIVE THE CUT
The champion and how they won it; the runner-up; the regular-season leader where that was somebody else; the season's defining scoring storyline; the decisive playoff result; the most notable trade if there was one; the rivalry or manager storyline that mattered; and whatever the commissioner's own account makes clear was the point of the season.

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

POSTSEASON AND LAST PLACE
"playoffResults" contains championship-bracket games only — the games that decided the title. The league's consolation bracket (the "Toilet Bowl") is not in this packet at all. Never mention a toilet bowl, a consolation bracket, a placement game or a loser's bracket: you have no data on any of them.

"lastPlace" is the manager who finished BOTTOM OF THE REGULAR-SEASON STANDINGS, and that is the league's only definition of last place. Do not name anyone else as the season's loser, and never infer last place from a postseason result.

Never use the words "consolation" or "placement game" anywhere in the article, in any sense — not even the ordinary English "the consolation of third place". Those words name a bracket this league runs and does not count, and a reader cannot tell which meaning you intended. A third-place game and a fifth-place game in "playoffResults" ARE championship-bracket games between teams that made the playoffs; describe them as what they are ("the third-place game", "for fifth") without reaching for either word.

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

  let body = await provider.generate({
    promptVersion: SEASON_ARTICLE_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  /*
   * One corrective pass. The 2017 retrospective shipped with "made for plenty of
   * chatter" — ordinary English, and one of the words this site must never print,
   * because it is how the imported archive gets described. Same gate as the
   * manager profiles: the writer is shown its own phrase rather than reminded of
   * a rule it has already read.
   */
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (body.providerName === "mock") break;
    const problems = findEditorialProblems(body.text);
    if (problems.length === 0) break;
    body = await provider.generate({
      promptVersion: SEASON_ARTICLE_PROMPT_VERSION,
      systemPrompt,
      userPrompt: `${userPrompt}\n\n${rewriteWithoutProblemsInstruction(problems)}\n\nPrevious draft:\n${body.text}`,
      humorLevel: safeguards.humorLevel,
    });
  }

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
