import { prisma } from "@/lib/db";
import { getSleeperProvider, type SleeperProvider } from "@/server/sleeper/provider";
import { seasonPoints } from "@/server/sleeper/sync-service";

/**
 * DATA RECONCILIATION
 *
 * Recomputes the numbers every ranking, record and history page is built from
 * and compares them with the source they came from:
 *
 *   Sleeper seasons (2023+)
 *     - each team's stored W-L-T and points for/against vs Sleeper's roster
 *       totals (regular season, to the hundredth)
 *     - the same totals recomputed from the stored games vs Sleeper's, which
 *       catches a game stored wrong even when the stored totals are right
 *     - every stored score of a final week vs Sleeper's matchups endpoint,
 *       and that the two sides of each stored game were opponents on Sleeper
 *
 *   ESPN seasons (pre-2023)
 *     - the totals recomputed from the stored games vs the season totals ESPN
 *       reported at import time (FantasyTeam.wins/losses/pointsFor...)
 *
 * Read-only. `npm run verify:data` runs it across every season; the weekly
 * cron runs it for the current season after each sync and records any
 * mismatch in the run's audit log.
 */

export type MismatchScope = "team-stored" | "team-recomputed" | "matchup-score" | "matchup-pairing" | "matchup-missing";

export interface Mismatch {
  year: number;
  scope: MismatchScope;
  /** Team name, or "week N: team". */
  subject: string;
  field: string;
  expected: string | number;
  actual: string | number;
  /** Where `expected` came from. */
  source: "sleeper" | "espn-import";
  /**
   * "error": our data disagrees with the source. "source-discrepancy": the
   * source disagrees with itself — Sleeper's season total differs from the sum
   * of its own weekly scores, every one of which matches ours. Reported, not
   * counted as a failure: there is nothing on our side to correct.
   */
  severity: "error" | "source-discrepancy";
}

export interface SeasonVerification {
  year: number;
  dataSource: string;
  teamsChecked: number;
  scoresChecked: number;
  weeksChecked: number[];
  mismatches: Mismatch[];
  /** Mismatches with severity "error". */
  errors: number;
  /** Set when the season could not be checked at all. */
  error?: string;
}

export interface VerificationReport {
  checkedAt: string;
  seasons: SeasonVerification[];
  totalMismatches: number;
}

const EPS = 0.006;
const round2 = (n: number) => Math.round(n * 100) / 100;
const differs = (a: number, b: number) => Math.abs(a - b) > EPS;

interface Totals {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

/** Regular-season totals per fantasy team, from the stored final games. */
async function recomputeFromGames(seasonId: string): Promise<Map<string, Totals>> {
  const games = await prisma.matchup.findMany({
    where: { seasonId, isPlayoff: false, status: "FINAL" },
    select: { teams: { select: { fantasyTeamId: true, score: true } } },
  });
  const totals = new Map<string, Totals>();
  const of = (id: string) => {
    let t = totals.get(id);
    if (!t) totals.set(id, (t = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }));
    return t;
  };
  for (const g of games) {
    if (g.teams.length !== 2 || g.teams.some((t) => t.score == null)) continue;
    const [a, b] = g.teams;
    const ta = of(a.fantasyTeamId);
    const tb = of(b.fantasyTeamId);
    ta.pointsFor += a.score!;
    ta.pointsAgainst += b.score!;
    tb.pointsFor += b.score!;
    tb.pointsAgainst += a.score!;
    if (a.score === b.score) {
      ta.ties += 1;
      tb.ties += 1;
    } else if (a.score! > b.score!) {
      ta.wins += 1;
      tb.losses += 1;
    } else {
      tb.wins += 1;
      ta.losses += 1;
    }
  }
  for (const t of totals.values()) {
    t.pointsFor = round2(t.pointsFor);
    t.pointsAgainst = round2(t.pointsAgainst);
  }
  return totals;
}

function compareTotals(
  out: Mismatch[],
  year: number,
  scope: MismatchScope,
  subject: string,
  expected: Totals,
  actual: Totals,
  source: Mismatch["source"],
  tolerance = EPS,
) {
  for (const field of ["wins", "losses", "ties"] as const) {
    if (expected[field] !== actual[field]) out.push({ year, scope, subject, field, expected: expected[field], actual: actual[field], source, severity: "error" });
  }
  for (const field of ["pointsFor", "pointsAgainst"] as const) {
    if (Math.abs(expected[field] - actual[field]) > tolerance) {
      out.push({ year, scope, subject, field, expected: round2(expected[field]), actual: round2(actual[field]), source, severity: "error" });
    }
  }
}

/** Summing per-week scores rounded to the hundredth can drift by half a hundredth a game. */
const sumTolerance = (t: Totals) => EPS + 0.005 * (t.wins + t.losses + t.ties);

async function verifySleeperSeason(
  season: { id: string; year: number; dataSource: string; sleeperLeagueId: string },
  provider: SleeperProvider,
): Promise<SeasonVerification> {
  const result: SeasonVerification = { year: season.year, dataSource: season.dataSource, teamsChecked: 0, scoresChecked: 0, weeksChecked: [], mismatches: [], errors: 0 };
  const m = result.mismatches;
  const year = season.year;

  const [rosters, teams, recomputed] = await Promise.all([
    provider.getRosters(season.sleeperLeagueId),
    prisma.fantasyTeam.findMany({
      where: { seasonId: season.id },
      select: { id: true, teamName: true, sleeperRosterId: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgainst: true },
    }),
    recomputeFromGames(season.id),
  ]);
  const teamByRoster = new Map(teams.filter((t) => t.sleeperRosterId).map((t) => [t.sleeperRosterId!, t]));
  const nameOf = new Map(teams.map((t) => [t.id, t.teamName]));

  // 1. Team totals: stored and recomputed, both against Sleeper.
  for (const r of rosters) {
    const team = teamByRoster.get(String(r.roster_id));
    if (!team) {
      m.push({ year, scope: "team-stored", subject: `roster ${r.roster_id}`, field: "team", expected: "present", actual: "missing", source: "sleeper", severity: "error" });
      continue;
    }
    result.teamsChecked += 1;
    const sleeper: Totals = {
      wins: r.settings.wins,
      losses: r.settings.losses,
      ties: r.settings.ties,
      pointsFor: seasonPoints(r.settings.fpts, r.settings.fpts_decimal),
      pointsAgainst: seasonPoints(r.settings.fpts_against, r.settings.fpts_against_decimal),
    };
    compareTotals(m, year, "team-stored", team.teamName, sleeper, team, "sleeper", sumTolerance(sleeper));
    const fromGames = recomputed.get(team.id) ?? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
    compareTotals(m, year, "team-recomputed", team.teamName, sleeper, fromGames, "sleeper", sumTolerance(fromGames));
  }

  // 2. Every stored score of every final week, against Sleeper's matchups.
  const finals = await prisma.matchup.findMany({
    where: { seasonId: season.id, status: "FINAL" },
    select: { week: true, sleeperMatchupId: true, teams: { select: { fantasyTeamId: true, score: true } } },
    orderBy: { week: "asc" },
  });
  const weeks = [...new Set(finals.map((f) => f.week))];
  result.weeksChecked = weeks;
  const rosterOfTeam = new Map(teams.map((t) => [t.id, t.sleeperRosterId]));
  for (const week of weeks) {
    const live = await provider.getMatchups(season.sleeperLeagueId, week);
    const liveByRoster = new Map(live.map((x) => [String(x.roster_id), x]));
    for (const game of finals.filter((f) => f.week === week)) {
      const sleeperGroups = new Set<number | null>();
      for (const side of game.teams) {
        const label = `week ${week}: ${nameOf.get(side.fantasyTeamId) ?? side.fantasyTeamId}`;
        const roster = rosterOfTeam.get(side.fantasyTeamId);
        const entry = roster ? liveByRoster.get(roster) : undefined;
        if (!entry) {
          m.push({ year, scope: "matchup-missing", subject: label, field: "score", expected: "on Sleeper", actual: "not found", source: "sleeper", severity: "error" });
          continue;
        }
        result.scoresChecked += 1;
        sleeperGroups.add(entry.matchup_id ?? null);
        // A commissioner override (custom_points) is the official score.
        const expected = round2(entry.custom_points ?? entry.points ?? 0);
        if (side.score == null || differs(expected, side.score)) {
          m.push({ year, scope: "matchup-score", subject: label, field: "score", expected, actual: side.score ?? "null", source: "sleeper", severity: "error" });
        }
      }
      if (game.teams.length === 2 && sleeperGroups.size > 1) {
        m.push({
          year,
          scope: "matchup-pairing",
          subject: `week ${week}: ${game.teams.map((t) => nameOf.get(t.fantasyTeamId)).join(" vs ")}`,
          field: "opponents",
          expected: "same Sleeper matchup",
          actual: [...sleeperGroups].join(" / "),
          source: "sleeper",
          severity: "error",
        });
      }
    }
  }
  // If every weekly score matches Sleeper but a points total does not, the
  // difference is inside Sleeper: its season total disagrees with its own weeks.
  const scoresAgree = !m.some((x) => x.scope.startsWith("matchup-"));
  if (scoresAgree) {
    const recomputedPointGaps = new Set(
      m.filter((x) => x.scope === "team-recomputed" && x.field.startsWith("points")).map((x) => `${x.subject}|${x.field}`),
    );
    for (const x of m) {
      if (x.field.startsWith("points") && recomputedPointGaps.has(`${x.subject}|${x.field}`)) {
        const stored = teams.find((t) => t.teamName === x.subject);
        const fromGames = stored ? recomputed.get(stored.id) : undefined;
        // Only when what we store IS the sum of the weekly scores.
        if (stored && fromGames && Math.abs(stored[x.field as "pointsFor"] - fromGames[x.field as "pointsFor"]) <= sumTolerance(fromGames)) {
          x.severity = "source-discrepancy";
        }
      }
    }
  }
  result.errors = m.filter((x) => x.severity === "error").length;
  return result;
}

async function verifyImportedSeason(season: { id: string; year: number; dataSource: string }): Promise<SeasonVerification> {
  const result: SeasonVerification = { year: season.year, dataSource: season.dataSource, teamsChecked: 0, scoresChecked: 0, weeksChecked: [], mismatches: [], errors: 0 };
  const [teams, recomputed, weeks] = await Promise.all([
    prisma.fantasyTeam.findMany({
      where: { seasonId: season.id },
      select: { id: true, teamName: true, wins: true, losses: true, ties: true, pointsFor: true, pointsAgainst: true },
    }),
    recomputeFromGames(season.id),
    prisma.matchup.findMany({ where: { seasonId: season.id, status: "FINAL" }, distinct: ["week"], select: { week: true }, orderBy: { week: "asc" } }),
  ]);
  result.weeksChecked = weeks.map((w) => w.week);
  for (const team of teams) {
    result.teamsChecked += 1;
    const fromGames = recomputed.get(team.id) ?? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
    result.scoresChecked += fromGames.wins + fromGames.losses + fromGames.ties;
    compareTotals(result.mismatches, season.year, "team-recomputed", team.teamName, team, fromGames, "espn-import", sumTolerance(fromGames));
  }
  result.errors = result.mismatches.filter((x) => x.severity === "error").length;
  return result;
}

export async function verifySeasonData(seasonId: string, provider: SleeperProvider = getSleeperProvider()): Promise<SeasonVerification> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    select: { id: true, year: true, dataSource: true, sleeperLeagueId: true },
  });
  try {
    if (season.dataSource === "SLEEPER" && season.sleeperLeagueId) {
      return await verifySleeperSeason({ ...season, sleeperLeagueId: season.sleeperLeagueId }, provider);
    }
    return await verifyImportedSeason(season);
  } catch (err) {
    return {
      year: season.year,
      dataSource: season.dataSource,
      teamsChecked: 0,
      scoresChecked: 0,
      weeksChecked: [],
      mismatches: [],
      errors: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function verifyAllData(options: { years?: number[] } = {}): Promise<VerificationReport> {
  const seasons = await prisma.season.findMany({
    where: options.years ? { year: { in: options.years } } : {},
    select: { id: true },
    orderBy: { year: "asc" },
  });
  const results: SeasonVerification[] = [];
  for (const s of seasons) results.push(await verifySeasonData(s.id));
  return {
    checkedAt: new Date().toISOString(),
    seasons: results,
    totalMismatches: results.reduce((n, r) => n + r.errors + (r.error ? 1 : 0), 0),
  };
}

/** One line per season, for logs and the cron's audit row. */
export function summarizeVerification(seasons: SeasonVerification[]): string {
  return seasons
    .map((s) =>
      s.error
        ? `${s.year}: could not verify (${s.error})`
        : `${s.year}: ${s.teamsChecked} teams, ${s.scoresChecked} scores, ${s.errors} mismatch${s.errors === 1 ? "" : "es"}` +
          (s.errors
            ? ` — ${s.mismatches
                .filter((x) => x.severity === "error")
                .slice(0, 3)
                .map((x) => `${x.subject} ${x.field} ${x.actual} (source ${x.expected})`)
                .join("; ")}`
            : ""),
    )
    .join(" | ");
}
