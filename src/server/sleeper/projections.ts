import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

/**
 * PROJECTIONS — Sleeper's free, public weekly player projections, scored with
 * THIS league's own scoring settings.
 *
 * Sleeper publishes projected stat lines (pass_yd, rec, rush_td, …) per player
 * per week at api.sleeper.com/projections. A player's projected fantasy points
 * are the dot product of that stat line with the league's `scoring_settings` —
 * the same arithmetic Sleeper uses for actual points — so the projections match
 * the league's rules (PPR, bonuses, kicker distance tiers) exactly.
 *
 * Stored on MatchupTeam.projectedScore (team: sum of its starters) and
 * WeeklyPlayerScore.projectedPoints (player, for weeks whose lineups are
 * stored). A week's projections are FROZEN at kickoff: the pipeline stops
 * updating them once the week starts, so the preview written Thursday and the
 * recap written Tuesday are judged against the same numbers.
 */

const PROJECTIONS_BASE = "https://api.sleeper.com/projections/nfl";

export type ScoringSettings = Record<string, number>;
export type StatLine = Record<string, number>;

/** Projected fantasy points for one stat line under the league's scoring. */
export function scoreStatLine(stats: StatLine, scoring: ScoringSettings): number {
  let total = 0;
  for (const [key, weight] of Object.entries(scoring)) {
    const value = stats[key];
    if (typeof value === "number" && Number.isFinite(value) && weight) total += value * weight;
  }
  return Math.round(total * 100) / 100;
}

export async function fetchScoringSettings(leagueId: string): Promise<ScoringSettings | null> {
  try {
    const res = await fetch(`${getEnv().SLEEPER_API_BASE_URL}/league/${leagueId}`, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const league = (await res.json()) as { scoring_settings?: ScoringSettings };
    return league.scoring_settings ?? null;
  } catch {
    return null;
  }
}

/** sleeperPlayerId -> projected stat line, for one week. */
export async function fetchWeekProjections(season: number, week: number): Promise<Map<string, StatLine>> {
  const positions = ["QB", "RB", "WR", "TE", "K", "DEF"].map((p) => `position%5B%5D=${p}`).join("&");
  const res = await fetch(`${PROJECTIONS_BASE}/${season}/${week}?season_type=regular&${positions}`, {
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Sleeper projections answered ${res.status} for ${season} week ${week}`);
  const rows = (await res.json()) as { player_id?: string; stats?: StatLine }[];
  const out = new Map<string, StatLine>();
  for (const r of rows) if (r.player_id && r.stats) out.set(r.player_id, r.stats);
  return out;
}

/** Starters per Sleeper roster id for a week (works before kickoff too). */
async function fetchWeekStarters(leagueId: string, week: number): Promise<Map<string, string[]>> {
  const res = await fetch(`${getEnv().SLEEPER_API_BASE_URL}/league/${leagueId}/matchups/${week}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Sleeper matchups answered ${res.status} for week ${week}`);
  const rows = (await res.json()) as { roster_id: number; starters?: string[] }[];
  return new Map(rows.map((r) => [String(r.roster_id), (r.starters ?? []).filter((s) => s && s !== "0")]));
}

export interface ProjectionSyncResult {
  week: number;
  teamsProjected: number;
  playersProjected: number;
  skipped?: string;
}

/**
 * Writes projections for one week of one Sleeper season.
 *
 *   - A week with stored lineups (final weeks): every stored player row gets
 *     projectedPoints; each team's projected total is the sum of its stored
 *     starters. Used to backfill completed weeks once.
 *   - A week not yet played: starters come live from Sleeper's matchups
 *     endpoint; only team totals are stored.
 *
 * `overwriteTeams`: true only before kickoff. After that a team's projected
 * total is written only where none exists, so the projection the preview was
 * written against is the one the recap is judged by.
 */
export async function syncWeekProjections(
  seasonId: string,
  week: number,
  options: { overwriteTeams?: boolean } = {},
): Promise<ProjectionSyncResult> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { year: true, dataSource: true, sleeperLeagueId: true },
  });
  if (!season || season.dataSource !== "SLEEPER" || !season.sleeperLeagueId) {
    return { week, teamsProjected: 0, playersProjected: 0, skipped: "Not a Sleeper season." };
  }

  const [scoring, projections] = await Promise.all([
    fetchScoringSettings(season.sleeperLeagueId),
    fetchWeekProjections(season.year, week),
  ]);
  if (!scoring) return { week, teamsProjected: 0, playersProjected: 0, skipped: "No scoring settings." };
  const pointsFor = (sleeperPlayerId: string | null | undefined) => {
    if (!sleeperPlayerId) return null;
    const stats = projections.get(sleeperPlayerId);
    return stats ? scoreStatLine(stats, scoring) : 0;
  };

  const matchupTeams = await prisma.matchupTeam.findMany({
    where: { matchup: { seasonId, week } },
    select: { id: true, fantasyTeamId: true, projectedScore: true, fantasyTeam: { select: { sleeperRosterId: true } } },
  });
  const rosters = await prisma.roster.findMany({
    where: { week, fantasyTeam: { seasonId } },
    select: {
      fantasyTeamId: true,
      playerScores: { select: { id: true, isStarter: true, player: { select: { sleeperPlayerId: true } } } },
    },
  });

  let playersProjected = 0;
  const teamTotals = new Map<string, number>();
  if (rosters.length > 0) {
    const updates: { id: string; projectedPoints: number }[] = [];
    for (const roster of rosters) {
      let total = 0;
      for (const ps of roster.playerScores) {
        const p = pointsFor(ps.player.sleeperPlayerId);
        if (p == null) continue;
        updates.push({ id: ps.id, projectedPoints: p });
        if (ps.isStarter) total += p;
      }
      teamTotals.set(roster.fantasyTeamId, Math.round(total * 100) / 100);
    }
    for (let i = 0; i < updates.length; i += 25) {
      await Promise.all(
        updates.slice(i, i + 25).map((u) =>
          prisma.weeklyPlayerScore.update({ where: { id: u.id }, data: { projectedPoints: u.projectedPoints } }),
        ),
      );
    }
    playersProjected = updates.length;
  } else {
    const starters = await fetchWeekStarters(season.sleeperLeagueId, week);
    for (const mt of matchupTeams) {
      const ids = starters.get(mt.fantasyTeam.sleeperRosterId ?? "") ?? [];
      if (ids.length === 0) continue;
      const total = ids.reduce((sum, id) => sum + (pointsFor(id) ?? 0), 0);
      teamTotals.set(mt.fantasyTeamId, Math.round(total * 100) / 100);
    }
  }

  let teamsProjected = 0;
  for (const mt of matchupTeams) {
    const total = teamTotals.get(mt.fantasyTeamId);
    if (total == null) continue;
    if (!options.overwriteTeams && mt.projectedScore != null) continue;
    await prisma.matchupTeam.update({ where: { id: mt.id }, data: { projectedScore: total } });
    teamsProjected += 1;
  }
  return { week, teamsProjected, playersProjected };
}

/**
 * Fills player projections for final Sleeper weeks that are missing them (the
 * sync rebuilds a just-finished week's player rows, and weeks played before
 * projections were stored have none). Newest weeks first, at most `maxWeeks`.
 */
export async function backfillProjections(maxWeeks: number): Promise<{ weeks: number; players: number }> {
  const missing = await prisma.roster.findMany({
    where: {
      fantasyTeam: { season: { dataSource: "SLEEPER" } },
      playerScores: { some: { projectedPoints: null } },
    },
    distinct: ["week", "fantasyTeamId"],
    select: { week: true, fantasyTeam: { select: { seasonId: true, season: { select: { year: true } } } } },
  });
  const keys = [...new Map(missing.map((m) => [`${m.fantasyTeam.seasonId}|${m.week}`, { seasonId: m.fantasyTeam.seasonId, year: m.fantasyTeam.season.year, week: m.week }])).values()]
    .sort((a, b) => b.year - a.year || b.week - a.week)
    .slice(0, maxWeeks);
  let players = 0;
  for (const k of keys) {
    const r = await syncWeekProjections(k.seasonId, k.week);
    players += r.playersProjected;
  }
  return { weeks: keys.length, players };
}
