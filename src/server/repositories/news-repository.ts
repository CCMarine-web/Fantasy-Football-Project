import { prisma } from "@/lib/db";
import { getMatchupAIContent } from "@/server/ai/weekly-pipeline";
import { getWeeklyAwards, type WeeklyAwardView } from "@/server/repositories/weekly-awards-repository";

export interface WeeklyRecapMatchup {
  matchupId: string;
  teams: { managerId: string; managerName: string; teamName: string; score: number | null; isWinner: boolean | null }[];
  recap: string | null;
}

export interface WeeklyRecapData {
  seasonYear: number;
  week: number;
  awards: WeeklyAwardView[];
  matchups: WeeklyRecapMatchup[];
  articleTitle: string | null;
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
      recap: (await getMatchupAIContent(m.id)).recap,
    })),
  );

  return { seasonYear: year, week, awards, matchups: recapMatchups, articleTitle: article?.title ?? null };
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
