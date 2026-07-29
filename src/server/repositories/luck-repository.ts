import {
  computeLuckScore,
  type LeagueWeekScore,
  type LuckGame,
  type LuckScore,
} from "@/server/stats/luck";
import { loadVerifiedGames, loadVerifiedTeamWeeks } from "./verified-games";
import { cached, CACHE_TAGS } from "@/server/cache";

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

/**
 * Both halves come from the verified-games loader, so a week a team abandoned
 * neither counts against its opponent's luck nor drags the league average that
 * everybody else's opponent-scoring component is measured against.
 *
 * A one-sided row (a bye, or an eliminated team still being scored) appears in
 * `league` but never in a game log: it counts toward the week's scoring but is
 * not a game anyone won or lost.
 */
async function load(year?: number): Promise<Loaded> {
  const [teamWeeks, rows] = await Promise.all([
    loadVerifiedTeamWeeks(year ? { year } : {}),
    loadVerifiedGames(year ? { year } : {}),
  ]);

  const league: LeagueWeekScore[] = teamWeeks.map((tw) => ({
    season: tw.year,
    week: tw.week,
    managerId: tw.managerId,
    points: tw.points,
    isPlayoff: tw.isPlayoff,
  }));

  const gamesByManager = new Map<string, LuckGame[]>();
  for (const row of rows) {
    const list = gamesByManager.get(row.managerId) ?? [];
    list.push({
      season: row.year,
      week: row.week,
      isPlayoff: row.isPlayoff,
      bracket: row.bracket,
      pointsFor: row.score,
      pointsAgainst: row.opponentScore,
      result: row.isWinner === true ? "W" : row.isWinner === false ? "L" : "T",
      opponentId: row.opponentManagerId,
    });
    gamesByManager.set(row.managerId, list);
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

/**
 * Career Luck Score for every manager who has played a game.
 *
 * Cached as a serialisable array and rebuilt into a Map on the way out — the
 * Next data cache round-trips through JSON, and a Map serialises to `{}`.
 */
export const getCareerLuck = async (): Promise<Map<string, LuckScore>> =>
  new Map(await loadCareerLuckEntries());

const loadCareerLuckEntries = cached(
  async (): Promise<[string, LuckScore][]> => [...scoreAll(await load()).entries()],
  ["career-luck"],
  { tags: [CACHE_TAGS.league, CACHE_TAGS.managers] },
);

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
