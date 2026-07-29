import { prisma } from "@/lib/db";
import { excerpt, paragraphsOf, wordCount } from "@/lib/excerpt";
import { cached, CACHE_TAGS } from "@/server/cache";

/**
 * League-average score per season.
 *
 * VERIFIED scores only, like every other statistic on the site. Without the
 * filter, a week a team abandoned contributed its run of zeros to the league
 * average, so the chart showed scoring dipping in seasons where it had not — the
 * same defect that put an abandoned team's 0.0 at the top of the Hall of Shame.
 * Seasons with no verified score at all are omitted rather than plotted at zero.
 */
export const getLeagueScoringTrend = cached(
  async (): Promise<{ season: number; averageScore: number }[]> => {
    const seasons = await prisma.season.findMany({ orderBy: { year: "asc" } });
    const results = await Promise.all(
      seasons.map(async (season) => {
        const agg = await prisma.matchupTeam.aggregate({
          where: { matchup: { seasonId: season.id }, score: { not: null }, verifiedScore: true },
          _avg: { score: true },
          _count: { _all: true },
        });
        return {
          season: season.year,
          averageScore: agg._avg.score ?? 0,
          scores: agg._count._all,
        };
      }),
    );
    return results
      .filter((r) => r.scores > 0)
      .map(({ season, averageScore }) => ({ season, averageScore }));
  },
  ["league-scoring-trend"],
  { tags: [CACHE_TAGS.league] },
);

export const listSeasonsWithChampions = cached(
  async () =>
    prisma.season.findMany({
      orderBy: { year: "desc" },
      include: {
        championship: {
          include: {
            championFantasyTeam: true,
            championManager: true,
            runnerUpFantasyTeam: { include: { manager: true } },
          },
        },
      },
    }),
  ["seasons-with-champions"],
  { tags: [CACHE_TAGS.league] },
);

export async function getSeasonHistory(year: number) {
  const season = await prisma.season.findFirst({
    where: { year },
    include: {
      championship: {
        include: {
          championFantasyTeam: { include: { manager: true } },
          runnerUpFantasyTeam: { include: { manager: true } },
          thirdPlaceFantasyTeam: { include: { manager: true } },
        },
      },
      fantasyTeams: {
        include: { manager: true },
        orderBy: { regularSeasonRank: "asc" },
      },
      drafts: {
        include: {
          picks: { include: { player: true, manager: true }, orderBy: { pickNumber: "asc" } },
        },
      },
    },
  });
  if (!season) return null;

  const standingSnapshots = await prisma.standingSnapshot.findMany({
    where: { seasonId: season.id },
    orderBy: [{ week: "asc" }, { rank: "asc" }],
  });

  const playoffMatchups = await prisma.matchup.findMany({
    where: { seasonId: season.id, isPlayoff: true },
    include: {
      teams: { include: { fantasyTeam: { include: { manager: true } } } },
    },
    orderBy: [{ playoffRound: "asc" }],
  });

  // `points: { not: null }` is load-bearing, not defensive: Postgres sorts
  // NULLs FIRST on a DESC ordering, so without it an ESPN-era row (membership
  // known, weekly score unknown) would be returned as the season's top score.
  const highestScore = await prisma.weeklyPlayerScore.findFirst({
    where: { roster: { fantasyTeam: { seasonId: season.id } }, points: { not: null } },
    include: { player: true, roster: { include: { fantasyTeam: { include: { manager: true } } } } },
    orderBy: { points: "desc" },
  });

  const notableTrades = await prisma.trade.findMany({
    where: { isNotable: true, transaction: { seasonId: season.id } },
    include: {
      transaction: {
        include: { assets: { include: { player: true, fantasyTeam: { include: { manager: true } } } } },
      },
    },
  });

  return { season, standingSnapshots, playoffMatchups, highestScore, notableTrades };
}

export interface HistoryNarrativeSection {
  id: string;
  year: number | null;
  title: string;
  body: string;
  sourceRef: string | null;
}

/**
 * Approved commissioner-history narrative sections (SEASON_SUMMARY etc.),
 * newest year first. Only APPROVED rows are public; PENDING "needs review"
 * items stay in the admin queue. This is narrative context — it never
 * overrides verified Sleeper standings/records.
 */
export async function listApprovedHistorySections(): Promise<HistoryNarrativeSection[]> {
  const rows = await prisma.leagueHistorySection.findMany({
    where: { approvalStatus: "APPROVED", sectionType: { not: "OTHER" } },
    orderBy: [{ year: "desc" }, { sortOrder: "asc" }],
    select: { id: true, year: true, title: true, body: true, sourceRef: true },
  });
  return rows;
}

export interface SeasonArticleView {
  id: string;
  year: number;
  title: string;
  /** Paragraphs, already split, ready to render. */
  paragraphs: string[];
}

/**
 * A season article trimmed for the /history index.
 *
 * The index used to print every season's article in full — nine complete
 * retrospectives on one page, several thousand words, most of it restating the
 * standings and champion that the tables immediately below already show. The
 * complete recap still lives on /history/[year]; this is the 150-250 words that
 * make somebody want to read it.
 */
export interface SeasonPreviewView extends SeasonArticleView {
  /** 150-250 words, cut from `paragraphs` on a paragraph or sentence boundary. */
  preview: string[];
  /** True when the preview is shorter than the article it came from. */
  isTruncated: boolean;
  /** Words in the full article, so the link can say how much more there is. */
  fullWordCount: number;
}

const PREVIEW_MIN_WORDS = 150;
const PREVIEW_MAX_WORDS = 250;

export function toSeasonPreview(article: SeasonArticleView): SeasonPreviewView {
  const full = article.paragraphs.join("\n\n");
  const trimmed = excerpt(full, { minWords: PREVIEW_MIN_WORDS, maxWords: PREVIEW_MAX_WORDS }) ?? "";
  return {
    ...article,
    preview: paragraphsOf(trimmed),
    isTruncated: wordCount(trimmed) < wordCount(full),
    fullWordCount: wordCount(full),
  };
}

/**
 * The published season retrospectives, newest first.
 *
 * These are written once by scripts/ai/generate-season-articles.ts and stored,
 * so the page is a read. It used to render `LeagueHistorySection.body` raw —
 * the transcribed commissioner pages, complete with "RECAP PART 2" markers and
 * sentences cut off mid-clause where one photograph ended.
 */
/** The published retrospective for one season, or null if none is written. */
export async function getSeasonArticle(year: number): Promise<SeasonArticleView | null> {
  const article = await prisma.article.findFirst({
    where: { type: "SEASON_SUMMARY", status: "PUBLISHED", deletedAt: null, season: { year } },
    select: {
      id: true,
      title: true,
      season: { select: { year: true } },
      sections: { orderBy: { order: "asc" }, select: { body: true } },
    },
  });
  if (!article) return null;
  return {
    id: article.id,
    year: article.season.year,
    title: article.title,
    paragraphs: article.sections
      .flatMap((s) => s.body.split(/\n\s*\n/))
      .map((p) => p.trim())
      .filter(Boolean),
  };
}

/**
 * The /history index: every season's article, each trimmed to a preview.
 *
 * Cached along with the two other index loaders below. Nine published articles,
 * the champion of every season and a league-wide scoring trend is the whole page,
 * and none of it changes between syncs — it was rendering behind a skeleton for
 * data that had been the same for weeks.
 */
export const listSeasonPreviews = cached(
  async (): Promise<SeasonPreviewView[]> => (await listSeasonArticles()).map(toSeasonPreview),
  ["season-previews"],
  { tags: [CACHE_TAGS.league, CACHE_TAGS.content] },
);

export async function listSeasonArticles(): Promise<SeasonArticleView[]> {
  const articles = await prisma.article.findMany({
    where: { type: "SEASON_SUMMARY", status: "PUBLISHED", deletedAt: null },
    orderBy: { season: { year: "desc" } },
    select: {
      id: true,
      title: true,
      season: { select: { year: true } },
      sections: { orderBy: { order: "asc" }, select: { body: true } },
    },
  });

  return articles.map((article) => ({
    id: article.id,
    year: article.season.year,
    title: article.title,
    paragraphs: article.sections
      .flatMap((s) => s.body.split(/\n\s*\n/))
      .map((p) => p.trim())
      .filter(Boolean),
  }));
}
