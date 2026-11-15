import { prisma } from "@/lib/db";
import { matchupTexts, newsIssueText, awardsText } from "@/server/text/page-texts";
import type { RenderedText } from "@/server/text/read";
import { getWeeklyAwards, type WeeklyAwardView } from "@/server/repositories/weekly-awards-repository";

export interface WeeklyRecapMatchup {
  matchupId: string;
  teams: { managerId: string; managerName: string; teamName: string; score: number | null; isWinner: boolean | null }[];
  recap: RenderedText | null;
}

export interface WeeklyRecapData {
  seasonYear: number;
  week: number;
  awards: WeeklyAwardView[];
  matchups: WeeklyRecapMatchup[];
  articleTitle: string | null;
  /** The weekly issue (facts-first), and the awards copy. */
  issue: RenderedText | null;
  awardsCopy: RenderedText | null;
}

/**
 * Assembles a week's recap page from whatever exists: final matchup scores +
 * their AI recaps, the deterministic weekly awards, and an article title if
 * one was published. Returns null only when the week has no matchups at all.
 */
export async function getWeeklyRecap(year: number, week: number): Promise<WeeklyRecapData | null> {
  const season = await prisma.season.findFirst({ where: { year }, select: { id: true } });
  if (!season) return null;
  const matchups = await prisma.matchup.findMany({
    where: { seasonId: season.id, week },
    include: { teams: { include: { fantasyTeam: { include: { manager: true } } } } },
    orderBy: { id: "asc" },
  });
  if (matchups.length === 0) return null;

  const [awards, article] = await Promise.all([
    getWeeklyAwards(season.id, week),
    getArticleBySeasonWeek(year, week),
  ]);

  const recapMatchups: WeeklyRecapMatchup[] = await Promise.all(
    matchups.map(async (m) => ({
      matchupId: m.id,
      teams: m.teams.map((t) => ({
        managerId: t.fantasyTeam.managerId,
        managerName: t.fantasyTeam.manager.displayName,
        teamName: t.fantasyTeam.teamName,
        score: t.score,
        isWinner: t.isWinner,
      })),
      recap: (await matchupTexts(m.id)).recap,
    })),
  );

  const [issue, awardsCopy] = await Promise.all([newsIssueText(year, week), awardsText(season.id, year, week)]);
  return { seasonYear: year, week, awards, matchups: recapMatchups, articleTitle: article?.title ?? null, issue, awardsCopy };
}

/**
 * This season's weekly issues: every week with final results. The archive
 * listed only published Article rows (season retrospectives), so the weekly
 * pages the site actually produces — results, recaps, awards — were reachable
 * only from a link elsewhere.
 */
export async function listCurrentWeeklyIssues(): Promise<{ year: number; week: number }[]> {
  const season = await prisma.season.findFirst({ where: { isCurrent: true }, select: { id: true, year: true } });
  if (!season) return [];
  const weeks = await prisma.matchup.findMany({
    where: { seasonId: season.id, status: "FINAL", teams: { some: { score: { not: null } } } },
    distinct: ["week"],
    select: { week: true },
    orderBy: { week: "desc" },
  });
  return weeks.map((w) => ({ year: season.year, week: w.week }));
}

export async function listPublishedArticles() {
  return prisma.article.findMany({
    where: { status: "PUBLISHED", deletedAt: null },
    include: { season: true },
    orderBy: [{ season: { year: "desc" } }, { week: "desc" }],
  });
}

export async function getArticleBySeasonWeek(year: number, week: number) {
  return prisma.article.findFirst({
    where: { season: { year }, week, status: "PUBLISHED", deletedAt: null },
    include: {
      season: true,
      sections: { orderBy: { order: "asc" }, include: { relatedManager: true } },
    },
  });
}
