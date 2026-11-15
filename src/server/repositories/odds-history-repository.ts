import { prisma } from "@/lib/db";
import { cached, CACHE_TAGS } from "@/server/cache";
import { simulatePlayoffOdds } from "@/server/stats/playoff-odds";
import { loadVerifiedGames } from "./verified-games";

/**
 * PLAYOFF ODDS BY WEEK — the simulation as it stood after each week.
 *
 * The standings run the same simulation (same seed, same 10,000 seasons) on the
 * games played so far. Here it is re-run on the games through each earlier
 * week, so the history is what the page would have said that week, and stored
 * so it never moves afterwards. The latest week is recomputed every run.
 */

export interface OddsPoint {
  week: number;
  fantasyTeamId: string;
  playoffPct: number;
  byePct: number;
  titlePct: number;
}

async function computeOddsAsOf(seasonId: string, throughWeek: number, playoffTeams: number) {
  const [teams, verified, remaining] = await Promise.all([
    prisma.fantasyTeam.findMany({ where: { seasonId }, select: { id: true, teamName: true } }),
    loadVerifiedGames({ seasonId }),
    prisma.matchup.findMany({
      where: { seasonId, isPlayoff: false, week: { gt: throughWeek } },
      select: { teams: { select: { fantasyTeamId: true } } },
    }),
  ]);
  const games = remaining.filter((g) => g.teams.length === 2).map((g) => ({ a: g.teams[0].fantasyTeamId, b: g.teams[1].fantasyTeamId }));
  if (games.length === 0) return null;
  const played = verified.filter((g) => !g.isPlayoff && g.week <= throughWeek).sort((a, b) => a.week - b.week);
  return simulatePlayoffOdds({
    teams: teams.map((t) => {
      const mine = played.filter((g) => g.fantasyTeamId === t.id);
      return {
        id: t.id,
        name: t.teamName,
        wins: mine.filter((g) => g.score > g.opponentScore).length,
        losses: mine.filter((g) => g.score < g.opponentScore).length,
        ties: mine.filter((g) => g.score === g.opponentScore).length,
        pointsFor: mine.reduce((s, g) => s + g.score, 0),
        pointsAgainst: mine.reduce((s, g) => s + g.opponentScore, 0),
        scores: mine.map((g) => g.score),
      };
    }),
    remaining: games,
    playoffTeams,
    sims: 10_000,
  });
}

/**
 * Stores the odds after every completed regular-season week of the current
 * season: missing weeks are backfilled, the latest week is refreshed. Returns
 * how many weeks were written.
 */
export async function storeOddsHistory(): Promise<number> {
  const season = await prisma.season.findFirst({
    where: { isCurrent: true, status: "IN_PROGRESS" },
    select: { id: true, year: true, playoffTeams: true, playoffStartWeek: true },
  });
  if (!season) return 0;
  const verified = await loadVerifiedGames({ seasonId: season.id });
  const lastWeek = Math.max(0, ...verified.filter((g) => !g.isPlayoff).map((g) => g.week));
  const lastRegular = season.playoffStartWeek - 1;
  const existing = new Set(
    (await prisma.playoffOddsSnapshot.findMany({ where: { seasonYear: season.year }, select: { week: true }, distinct: ["week"] })).map((r) => r.week),
  );
  let written = 0;
  for (let week = 1; week <= Math.min(lastWeek, lastRegular - 1); week += 1) {
    if (existing.has(week) && week < lastWeek) continue;
    const odds = await computeOddsAsOf(season.id, week, season.playoffTeams);
    if (!odds) continue;
    for (const [fantasyTeamId, o] of odds) {
      const data = { playoffPct: o.playoffPct, byePct: o.byePct, titlePct: o.titlePct };
      await prisma.playoffOddsSnapshot.upsert({
        where: { seasonYear_week_fantasyTeamId: { seasonYear: season.year, week, fantasyTeamId } },
        create: { seasonYear: season.year, week, fantasyTeamId, ...data },
        update: data,
      });
    }
    written += 1;
  }
  return written;
}

export function getOddsHistory(seasonYear: number): Promise<OddsPoint[]> {
  return cached(
    () =>
      prisma.playoffOddsSnapshot.findMany({
        where: { seasonYear },
        orderBy: [{ week: "asc" }],
        select: { week: true, fantasyTeamId: true, playoffPct: true, byePct: true, titlePct: true },
      }),
    ["odds-history", String(seasonYear)],
    { tags: [CACHE_TAGS.league] },
  )();
}
