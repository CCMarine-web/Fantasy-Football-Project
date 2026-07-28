import { prisma } from "@/lib/db";
import {
  computeLuckScore,
  type LeagueWeekScore,
  type LuckGame,
  type LuckScore,
} from "@/server/stats/luck";

/**
 * Loads the league-wide game data the Luck Score needs and computes it for
 * every manager in one pass, career-wide and for a single season.
 *
 * Everything is read from recorded scores — there is no stored luck value to
 * drift out of date, and no AI anywhere near it.
 */

interface Loaded {
  gamesByManager: Map<string, LuckGame[]>;
  league: LeagueWeekScore[];
}

async function load(year?: number): Promise<Loaded> {
  const rows = await prisma.matchupTeam.findMany({
    where: {
      score: { not: null },
      ...(year ? { matchup: { season: { year } } } : {}),
    },
    select: {
      score: true,
      isWinner: true,
      fantasyTeamId: true,
      fantasyTeam: { select: { managerId: true } },
      matchup: {
        select: {
          week: true,
          isPlayoff: true,
          bracketType: true,
          season: { select: { year: true } },
          teams: {
            select: {
              fantasyTeamId: true,
              score: true,
              fantasyTeam: { select: { managerId: true } },
            },
          },
        },
      },
    },
  });

  const league: LeagueWeekScore[] = [];
  const gamesByManager = new Map<string, LuckGame[]>();

  for (const mt of rows) {
    if (mt.score == null) continue;
    const managerId = mt.fantasyTeam.managerId;
    if (!managerId) continue;

    league.push({
      season: mt.matchup.season.year,
      week: mt.matchup.week,
      managerId,
      points: mt.score,
      isPlayoff: mt.matchup.isPlayoff,
    });

    // A one-sided postseason row is a bye or an eliminated team still being
    // scored. It counts toward the league's weekly scoring but is not a game
    // anyone won or lost, so it never enters a manager's game log.
    const opponent = mt.matchup.teams.find((t) => t.fantasyTeamId !== mt.fantasyTeamId);
    if (!opponent || opponent.score == null || !opponent.fantasyTeam.managerId) continue;

    const list = gamesByManager.get(managerId) ?? [];
    list.push({
      season: mt.matchup.season.year,
      week: mt.matchup.week,
      isPlayoff: mt.matchup.isPlayoff,
      bracket: mt.matchup.bracketType,
      pointsFor: mt.score,
      pointsAgainst: opponent.score,
      result: mt.isWinner === true ? "W" : mt.isWinner === false ? "L" : "T",
      opponentId: opponent.fantasyTeam.managerId,
    });
    gamesByManager.set(managerId, list);
  }

  return { gamesByManager, league };
}

function scoreAll({ gamesByManager, league }: Loaded): Map<string, LuckScore> {
  const out = new Map<string, LuckScore>();
  for (const [managerId, games] of gamesByManager) {
    out.set(managerId, computeLuckScore(managerId, games, league));
  }
  return out;
}

/** Career Luck Score for every manager who has played a game. */
export async function getCareerLuck(): Promise<Map<string, LuckScore>> {
  return scoreAll(await load());
}

/** Luck Score for a single season, for every manager who played in it. */
export async function getSeasonLuck(year: number): Promise<Map<string, LuckScore>> {
  return scoreAll(await load(year));
}

/**
 * Both scores for one manager. The season score is for the most recent season
 * they have games in, which is the one a reader means by "this season"; when
 * that season has barely started it correctly reports INSUFFICIENT rather than
 * pretending the luck has evened out.
 */
export async function getManagerLuck(
  managerId: string,
): Promise<{ career: LuckScore | null; season: LuckScore | null; seasonYear: number | null }> {
  const loaded = await load();
  const games = loaded.gamesByManager.get(managerId);
  if (!games || games.length === 0) return { career: null, season: null, seasonYear: null };

  const career = computeLuckScore(managerId, games, loaded.league);

  const latestPlayed = Math.max(...games.map((g) => g.season));
  // The current season is whatever the league's newest season is — which may be
  // one this manager has not played a game in yet.
  const newestSeason = Math.max(...loaded.league.map((r) => r.season));
  const seasonYear = Math.max(latestPlayed, newestSeason);
  const seasonGames = games.filter((g) => g.season === seasonYear);
  const seasonLeague = loaded.league.filter((r) => r.season === seasonYear);
  const season = computeLuckScore(managerId, seasonGames, seasonLeague);

  return { career, season, seasonYear };
}
