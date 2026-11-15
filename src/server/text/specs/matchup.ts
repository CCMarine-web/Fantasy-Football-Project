import { prisma } from "@/lib/db";
import { describeSeries, summarizeSeries } from "@/server/stats/head-to-head";
import { rankStandings } from "@/server/stats/standings";
import { toGameResult, type VerifiedGameRow } from "@/server/repositories/verified-games";
import { getVerifiedRowsCached } from "@/server/repositories/head-to-head-repository";
import type { TextSpec } from "../core";

/**
 * Matchup previews and recaps.
 *
 * PREVIEW facts are the state ENTERING the week — records, standings, series
 * and form from games before it, the frozen projections, last week's power
 * ranking snapshot — so they are identical whether built on Thursday or after
 * the game. The preview stays valid once the result is in.
 *
 * RECAP facts use the SAME projections the preview used (stored on the
 * matchup, frozen at kickoff) and state the expectation deterministically:
 * "upset" only when the projected favourite lost. The model is never left to
 * decide whether a result was chalk.
 */

const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);

function before(rows: VerifiedGameRow[], year: number, week: number, inclusive: boolean) {
  return rows.filter((r) => r.year < year || (r.year === year && (inclusive ? r.week <= week : r.week < week)));
}

function recordOf(rows: VerifiedGameRow[], managerId: string, year: number) {
  const games = rows.filter((r) => r.managerId === managerId && r.year === year && !r.isPlayoff);
  const wins = games.filter((g) => g.score > g.opponentScore).length;
  const losses = games.filter((g) => g.score < g.opponentScore).length;
  const pointsFor = games.reduce((s, g) => s + g.score, 0);
  const pointsAgainst = games.reduce((s, g) => s + g.opponentScore, 0);
  return { wins, losses, ties: games.length - wins - losses, pointsFor, pointsAgainst };
}

function standingsAt(rows: VerifiedGameRow[], year: number, managerIds: string[], names: Map<string, string>) {
  return rankStandings(
    managerIds.map((id) => ({ id, name: names.get(id) ?? id, ...recordOf(rows, id, year) })),
  );
}

function formOf(rows: VerifiedGameRow[], managerId: string, year: number): string {
  return rows
    .filter((r) => r.managerId === managerId && r.year === year && !r.isPlayoff)
    .sort((a, b) => a.week - b.week)
    .slice(-5)
    .map((g) => (g.score > g.opponentScore ? "W" : g.score < g.opponentScore ? "L" : "T"))
    .join("");
}

export interface MatchupInfo {
  matchupId: string;
  seasonId: string;
  year: number;
  week: number;
  isPlayoff: boolean;
  roundName: string | null;
  regularSeasonWeeks: number;
  playoffTeams: number;
  final: boolean;
  sides: {
    managerId: string;
    managerName: string;
    teamName: string;
    fantasyTeamId: string;
    score: number | null;
    projected: number | null;
  }[];
}

export async function loadMatchupInfo(matchupId: string): Promise<MatchupInfo | null> {
  const m = await prisma.matchup.findUnique({
    where: { id: matchupId },
    select: {
      id: true,
      seasonId: true,
      week: true,
      status: true,
      isPlayoff: true,
      roundName: true,
      season: { select: { year: true, regularSeasonWeeks: true, playoffTeams: true } },
      teams: {
        select: {
          fantasyTeamId: true,
          score: true,
          projectedScore: true,
          verifiedScore: true,
          fantasyTeam: { select: { teamName: true, managerId: true, manager: { select: { displayName: true } } } },
        },
        orderBy: { fantasyTeamId: "asc" },
      },
    },
  });
  if (!m || m.teams.length !== 2) return null;
  return {
    matchupId: m.id,
    seasonId: m.seasonId,
    year: m.season.year,
    week: m.week,
    isPlayoff: m.isPlayoff,
    roundName: m.roundName,
    regularSeasonWeeks: m.season.regularSeasonWeeks,
    playoffTeams: m.season.playoffTeams,
    final: m.status === "FINAL" && m.teams.every((t) => t.score != null && t.verifiedScore),
    sides: m.teams.map((t) => ({
      managerId: t.fantasyTeam.managerId,
      managerName: t.fantasyTeam.manager.displayName,
      teamName: t.fantasyTeam.teamName,
      fantasyTeamId: t.fantasyTeamId,
      score: t.score,
      projected: t.projectedScore,
    })),
  };
}

async function contextFor(info: MatchupInfo, inclusive: boolean) {
  const rows = await getVerifiedRowsCached();
  const scoped = before(rows, info.year, info.week, inclusive);
  const seasonManagers = [...new Set(rows.filter((r) => r.year === info.year).map((r) => r.managerId))];
  const names = new Map(rows.map((r) => [r.managerId, r.managerName]));
  const table = standingsAt(scoped, info.year, seasonManagers, names);
  const [a, b] = info.sides;
  const series = summarizeSeries(scoped.filter((r) => r.managerId === a.managerId).map(toGameResult), b.managerId);
  return { scoped, table, series, a, b };
}

async function powerRankBefore(info: MatchupInfo, fantasyTeamId: string): Promise<number | null> {
  if (info.week <= 1) return null;
  const snap = await prisma.powerRankingSnapshot.findUnique({
    where: { seasonYear_week_fantasyTeamId: { seasonYear: info.year, week: info.week - 1, fantasyTeamId } },
    select: { rank: true },
  });
  return snap?.rank ?? null;
}

export async function previewSpec(info: MatchupInfo): Promise<TextSpec> {
  const { scoped, table, series, a, b } = await contextFor(info, false);
  const side = async (s: (typeof info.sides)[number]) => {
    const rec = recordOf(scoped, s.managerId, info.year);
    return {
      manager: s.managerName,
      team: s.teamName,
      record: `${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ""}`,
      standing: table.find((t) => t.team.id === s.managerId)?.rank ?? null,
      powerRankEnteringWeek: await powerRankBefore(info, s.fantasyTeamId),
      projectedPoints: r1(s.projected),
      formLast5OldestFirst: formOf(scoped, s.managerId, info.year) || null,
    };
  };
  const [sa, sb] = await Promise.all([side(a), side(b)]);
  const favourite =
    a.projected != null && b.projected != null && Math.abs(a.projected - b.projected) >= 0.05
      ? a.projected > b.projected
        ? a.managerName
        : b.managerName
      : null;
  const seriesText = describeSeries(series, a.managerName, b.managerName);
  const facts = {
    season: info.year,
    week: info.week,
    round: info.roundName,
    playoffGame: info.isPlayoff,
    regularSeasonWeeksLeftAfterThis: info.isPlayoff ? 0 : Math.max(0, info.regularSeasonWeeks - info.week),
    playoffSpots: info.playoffTeams,
    sides: [sa, sb],
    projectedFavourite: favourite,
    projectedMargin: favourite ? r1(Math.abs((a.projected ?? 0) - (b.projected ?? 0))) : null,
    seriesEnteringWeek: { text: seriesText, meetings: series.games, playoffMeetings: series.playoff.games },
  };
  return {
    kind: "MATCHUP_PREVIEW",
    subjectKey: info.matchupId,
    asOfSeason: info.year,
    asOfWeek: info.week,
    facts,
    tokens: {
      series: seriesText,
      recordA: sa.record,
      recordB: sb.record,
      projA: sa.projectedPoints?.toFixed(1) ?? "—",
      projB: sb.projectedPoints?.toFixed(1) ?? "—",
    },
    contentType: "matchup-preview",
    task: `Preview Week ${info.week} of ${info.year}: ${a.managerName} (${a.teamName}) vs ${b.managerName} (${b.teamName}). Lead with the stakes and who the projections favour (if anyone), mention the head-to-head series, and end with a line of trash talk. Roast the play, not the person.`,
    fallback: favourite
      ? `${favourite} is the projected favourite (${a.managerName} {{projA}}, ${b.managerName} {{projB}}). ${a.managerName} comes in at {{recordA}}, ${b.managerName} at {{recordB}}. Series: {{series}}.`
      : `${a.managerName} ({{recordA}}) meets ${b.managerName} ({{recordB}}). Series: {{series}}.`,
    maxWords: 110,
  };
}

export async function recapSpec(info: MatchupInfo): Promise<TextSpec | null> {
  if (!info.final) return null;
  const { scoped, table, series, a, b } = await contextFor(info, true);
  const [sa, sb] = info.sides;
  const winner = (sa.score ?? 0) > (sb.score ?? 0) ? sa : (sb.score ?? 0) > (sa.score ?? 0) ? sb : null;
  const loser = winner ? (winner === sa ? sb : sa) : null;
  const favourite =
    sa.projected != null && sb.projected != null && Math.abs(sa.projected - sb.projected) >= 0.05
      ? sa.projected > sb.projected
        ? sa
        : sb
      : null;
  const expectation = !winner || !favourite ? "no projected favourite" : favourite === winner ? "as projected" : "upset";

  const players = await prisma.weeklyPlayerScore.findMany({
    where: { roster: { week: info.week, fantasyTeamId: { in: [sa.fantasyTeamId, sb.fantasyTeamId] } }, points: { not: null } },
    select: {
      points: true,
      projectedPoints: true,
      isStarter: true,
      roster: { select: { fantasyTeamId: true } },
      player: { select: { firstName: true, lastName: true, position: true } },
    },
  });
  const topFor = (teamId: string) =>
    players
      .filter((p) => p.roster.fantasyTeamId === teamId && p.isStarter)
      .sort((x, y) => (y.points ?? 0) - (x.points ?? 0))
      .slice(0, 2)
      .map((p) => ({ player: `${p.player.firstName} ${p.player.lastName}`, position: p.player.position, points: r1(p.points), projected: r1(p.projectedPoints) }));
  const benchFor = (teamId: string) => {
    const bench = players.filter((p) => p.roster.fantasyTeamId === teamId && !p.isStarter);
    const best = [...bench].sort((x, y) => (y.points ?? 0) - (x.points ?? 0))[0];
    return {
      benchPoints: r1(bench.reduce((s, p) => s + (p.points ?? 0), 0)),
      bestBenchPlayer: best ? { player: `${best.player.firstName} ${best.player.lastName}`, points: r1(best.points) } : null,
    };
  };
  const side = (s: typeof sa) => {
    const rec = recordOf(scoped, s.managerId, info.year);
    return {
      manager: s.managerName,
      team: s.teamName,
      score: r1(s.score),
      projectedPoints: r1(s.projected),
      recordAfter: `${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ""}`,
      standingAfter: table.find((t) => t.team.id === s.managerId)?.rank ?? null,
      topScorers: topFor(s.fantasyTeamId),
      ...benchFor(s.fantasyTeamId),
    };
  };
  const seriesText = describeSeries(series, a.managerName, b.managerName);
  const margin = winner && loser ? r1((winner.score ?? 0) - (loser.score ?? 0)) : 0;
  const facts = {
    season: info.year,
    week: info.week,
    round: info.roundName,
    playoffGame: info.isPlayoff,
    sides: [side(sa), side(sb)],
    winner: winner?.managerName ?? null,
    margin,
    projectedFavourite: favourite?.managerName ?? null,
    result: expectation,
    seriesAfter: { text: seriesText, meetings: series.games },
  };
  return {
    kind: "MATCHUP_RECAP",
    subjectKey: info.matchupId,
    asOfSeason: info.year,
    asOfWeek: info.week,
    facts,
    tokens: {
      scoreA: sa.score?.toFixed(1) ?? "—",
      scoreB: sb.score?.toFixed(1) ?? "—",
      margin: margin?.toFixed(1) ?? "—",
      series: seriesText,
      recordA: facts.sides[0].recordAfter,
      recordB: facts.sides[1].recordAfter,
    },
    contentType: "matchup-recap",
    task: `Recap Week ${info.week} of ${info.year}: ${sa.managerName} vs ${sb.managerName}. FACTS.result says whether the result went as projected or was an upset — follow it exactly; never call an upset "chalk" or a favourite's win a shock. Name who won and why (top scorers, bench decisions), then a roast line.`,
    fallback: winner
      ? `${winner.managerName} beat ${loser!.managerName} ${winner === sa ? "{{scoreA}}–{{scoreB}}" : "{{scoreB}}–{{scoreA}}"}${expectation === "upset" ? ", an upset by the projections" : ""}. Series: {{series}}.`
      : `${sa.managerName} and ${sb.managerName} tied {{scoreA}}–{{scoreB}}. Series: {{series}}.`,
    maxWords: 120,
  };
}

/** Every matchup that should have a preview or recap right now. */
export async function matchupSpecs(opts: {
  seasonId: string;
  recapWeeks: number[];
  previewWeeks: number[];
}): Promise<TextSpec[]> {
  const weeks = [...new Set([...opts.recapWeeks, ...opts.previewWeeks])];
  if (weeks.length === 0) return [];
  const matchups = await prisma.matchup.findMany({
    where: { seasonId: opts.seasonId, week: { in: weeks }, OR: [{ bracketType: null }, { bracketType: "WINNERS" }] },
    select: { id: true, week: true },
  });
  const specs: TextSpec[] = [];
  for (const m of matchups) {
    const info = await loadMatchupInfo(m.id);
    if (!info) continue;
    if (opts.previewWeeks.includes(m.week) || opts.recapWeeks.includes(m.week)) {
      // A recap week's game also keeps its preview on record.
      if (info.sides.every((s) => s.projected != null) || opts.previewWeeks.includes(m.week)) specs.push(await previewSpec(info));
    }
    if (opts.recapWeeks.includes(m.week)) {
      const recap = await recapSpec(info);
      if (recap) specs.push(recap);
    }
  }
  return specs;
}
