import { prisma } from "@/lib/db";
import { excerpt, paragraphsOf, wordCount } from "@/lib/excerpt";
import { cached, CACHE_TAGS } from "@/server/cache";
import { getLastPlaceBySeason } from "./hall-of-shame-repository";

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
  async (): Promise<{ season: number; averageScore: number; inProgress: boolean }[]> => {
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
          inProgress: season.status !== "COMPLETE",
        };
      }),
    );
    return results
      .filter((r) => r.scores > 0)
      .map(({ season, averageScore, inProgress }) => ({ season, averageScore, inProgress }));
  },
  ["league-scoring-trend-v2"],
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
    // Anything marked SENSITIVE or REDACTED stays off the public site.
    where: { approvalStatus: "APPROVED", sensitivity: "NONE", sectionType: { not: "OTHER" } },
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

export interface SeasonIndexPerson {
  /** Null when several managers share the line (names joined with " & "). */
  managerId: string | null;
  name: string;
  /** e.g. "11-3" or "1,712.4 PF". */
  note: string | null;
}

export interface SeasonIndexCard {
  id: string;
  year: number;
  status: string;
  /** True for any season that is not COMPLETE: nothing below is final. */
  inProgress: boolean;
  champion: SeasonIndexPerson | null;
  runnerUp: SeasonIndexPerson | null;
  /** Regular-season #1 by the platform's own standings order. */
  topSeed: SeasonIndexPerson | null;
  /** Most regular-season points; a tie names everyone in it. */
  pointsLeader: SeasonIndexPerson | null;
  /** Regular-season last place, the same finish the Hall of Shame lists. */
  lastPlace: SeasonIndexPerson | null;
}

const rec = (t: { wins: number; losses: number; ties: number }) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;

/**
 * One row per season for the /history index: champion, runner-up, #1 seed,
 * points leader and last place. A season still being played carries none of
 * them — a team leading in week 9 has not "finished first" — so the index
 * says "In progress" instead of claiming a final result.
 */
export const listSeasonIndex = cached(
  async (): Promise<SeasonIndexCard[]> => {
    const [seasons, lastPlace] = await Promise.all([
      prisma.season.findMany({
        orderBy: { year: "desc" },
        select: {
          id: true,
          year: true,
          status: true,
          championship: {
            select: {
              championManager: { select: { id: true, displayName: true } },
              championFantasyTeam: { select: { wins: true, losses: true, ties: true } },
              runnerUpFantasyTeam: { select: { manager: { select: { id: true, displayName: true } } } },
            },
          },
          fantasyTeams: {
            select: {
              wins: true,
              losses: true,
              ties: true,
              pointsFor: true,
              regularSeasonRank: true,
              manager: { select: { id: true, displayName: true } },
            },
          },
        },
      }),
      getLastPlaceBySeason(),
    ]);
    const lastByYear = new Map(lastPlace.map((l) => [l.year, l]));

    return seasons.map((s) => {
      const base = { id: s.id, year: s.year, status: s.status };
      if (s.status !== "COMPLETE") {
        return { ...base, inProgress: true, champion: null, runnerUp: null, topSeed: null, pointsLeader: null, lastPlace: null };
      }
      const played = s.fantasyTeams.filter((t) => t.wins + t.losses + t.ties > 0);
      const seed = played.find((t) => t.regularSeasonRank === 1);
      const topPf = Math.max(...played.map((t) => t.pointsFor));
      const leaders = played
        .filter((t) => Math.abs(t.pointsFor - topPf) < 0.005)
        .sort((a, b) => a.manager.displayName.localeCompare(b.manager.displayName));
      const last = lastByYear.get(s.year);
      const c = s.championship;
      return {
        ...base,
        inProgress: false,
        champion: c ? { managerId: c.championManager.id, name: c.championManager.displayName, note: rec(c.championFantasyTeam) } : null,
        runnerUp: c?.runnerUpFantasyTeam
          ? { managerId: c.runnerUpFantasyTeam.manager.id, name: c.runnerUpFantasyTeam.manager.displayName, note: null }
          : null,
        topSeed: seed ? { managerId: seed.manager.id, name: seed.manager.displayName, note: rec(seed) } : null,
        pointsLeader: leaders.length
          ? {
              managerId: leaders.length === 1 ? leaders[0].manager.id : null,
              name: leaders.map((t) => t.manager.displayName).join(" & "),
              note: `${topPf.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} PF`,
            }
          : null,
        lastPlace: last ? { managerId: last.managerId, name: last.managerName, note: last.record } : null,
      };
    });
  },
  ["season-index"],
  { tags: [CACHE_TAGS.league] },
);
