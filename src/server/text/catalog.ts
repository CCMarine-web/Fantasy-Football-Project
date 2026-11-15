import { prisma } from "@/lib/db";
import { getLeagueClock, type LeagueClock } from "@/server/league-clock";
import { getPowerRankings } from "@/server/repositories/power-rankings-repository";
import { getComputedRivalries } from "@/server/repositories/computed-rivalries-repository";
import { headToHeadLines, listManagerRows } from "@/server/repositories/manager-repository";
import { getCareerLuck } from "@/server/repositories/luck-repository";
import { getVerifiedRowsCached } from "@/server/repositories/head-to-head-repository";
import { getProvisionalRevisit, loadDraftReturns, gradeLetterToDisplay } from "@/server/repositories/draft-grade-repository";
import { getTradeTribunal } from "@/server/repositories/trade-tribunal-repository";
import { getWeeklyAwards } from "@/server/repositories/weekly-awards-repository";
import { computeRecordWatch } from "@/server/stats/record-watch";
import { weekKickoffMs } from "@/lib/nfl-schedule";
import type { TextKind, TextSpec } from "./core";
import { matchupSpecs } from "./specs/matchup";
import {
  awardsSpec,
  draftRevisitSpec,
  loadScoutingFacts,
  managerBioSpec,
  newsIssueSpec,
  powerBlurbSpecs,
  rivalrySpec,
  scoutingSpec,
  seasonRetroSpec,
  tradeVerdictSpec,
  type NewsIssueFacts,
} from "./specs/league";

/**
 * Every AI text that should exist right now, built from the same loaders the
 * pages use. The pipeline generates the stale ones; /api/health and
 * `npm run verify:texts` count them.
 *
 * When each kind is refreshed follows from its facts: a text is rewritten when
 * the hash of its facts changes, and the facts are chosen so that happens on
 * the right schedule —
 *   recaps / awards / news / power blurbs   the week's results (Tuesday)
 *   previews                                built from Thursday's projections
 *   rivalries                               only when the pair meets
 *   bios / scouting                         when the manager's numbers move
 *   draft revisit                           weekly, Sleeper seasons in progress
 *   trade verdicts                          while the valuation can still move
 *   season retrospective                    once, when the season completes
 */

/** Generation order: what readers see first goes first. */
export const KIND_PRIORITY: TextKind[] = [
  "MATCHUP_RECAP",
  "MATCHUP_PREVIEW",
  "POWER_BLURB",
  "WEEKLY_AWARDS",
  "NEWS_ISSUE",
  "RIVALRY",
  "MANAGER_BIO",
  "SCOUTING",
  "DRAFT_REVISIT",
  "TRADE_VERDICT",
  "SEASON_RETRO",
];

/** Previews become due ~14 h before kickoff (the Thursday 13:00 UTC job) and stay. */
const PREVIEW_LEAD_MS = 14 * 3_600_000;

export async function currentSeasonContext(clock?: LeagueClock | null) {
  const c = clock ?? (await getLeagueClock());
  const season = await prisma.season.findFirst({ where: { isCurrent: true } });
  return { clock: c, season };
}

export async function newsIssueFacts(seasonId: string, seasonYear: number, week: number): Promise<NewsIssueFacts> {
  const rows = await getVerifiedRowsCached();
  const thisWeek = rows.filter((r) => r.year === seasonYear && r.week === week && r.score > r.opponentScore);
  const projections = await prisma.matchupTeam.findMany({
    where: { matchup: { seasonId, week } },
    select: { fantasyTeamId: true, projectedScore: true },
  });
  const proj = new Map(projections.map((p) => [p.fantasyTeamId, p.projectedScore]));
  const results = thisWeek.map((r) => {
    const pw = proj.get(r.fantasyTeamId);
    const pl = proj.get(r.opponentTeamId);
    return {
      winner: r.managerName,
      loser: r.opponentManagerName,
      winnerScore: Math.round(r.score * 10) / 10,
      loserScore: Math.round(r.opponentScore * 10) / 10,
      result: pw != null && pl != null ? (pw >= pl ? "as projected" : "upset") : "no projection",
    };
  });

  const [awards, snaps, teams] = await Promise.all([
    getWeeklyAwards(seasonId, week),
    prisma.powerRankingSnapshot.findMany({ where: { seasonYear, week: { in: [week - 1, week] } } }),
    prisma.fantasyTeam.findMany({ where: { seasonId }, select: { id: true, teamName: true, managerId: true, manager: { select: { displayName: true } } } }),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const prev = new Map(snaps.filter((s) => s.week === week - 1).map((s) => [s.fantasyTeamId, s.rank]));
  const powerMovers = snaps
    .filter((s) => s.week === week && prev.has(s.fantasyTeamId) && prev.get(s.fantasyTeamId) !== s.rank)
    .map((s) => ({ team: teamById.get(s.fantasyTeamId)?.teamName ?? "", manager: teamById.get(s.fantasyTeamId)?.manager.displayName ?? "", from: prev.get(s.fantasyTeamId) as number, to: s.rank }))
    .sort((a, b) => Math.abs(b.from - b.to) - Math.abs(a.from - a.to))
    .slice(0, 3);

  // Record watch AS OF this week, so an old issue's facts never change.
  const asOf = rows.filter((r) => r.year < seasonYear || (r.year === seasonYear && r.week <= week));
  const completed = await prisma.fantasyTeam.findMany({
    where: { season: { status: "COMPLETE" } },
    select: { wins: true, losses: true, ties: true, pointsFor: true, manager: { select: { displayName: true } }, season: { select: { year: true } } },
  });
  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { regularSeasonWeeks: true } });
  const currentTeams = teams.map((t) => {
    const g = asOf.filter((r) => r.year === seasonYear && !r.isPlayoff && r.managerId === t.managerId);
    return {
      managerId: t.managerId,
      managerName: t.manager.displayName,
      wins: g.filter((x) => x.score > x.opponentScore).length,
      losses: g.filter((x) => x.score < x.opponentScore).length,
      ties: g.filter((x) => x.score === x.opponentScore).length,
      pointsFor: g.reduce((s, x) => s + x.score, 0),
    };
  });
  const recordWatch = computeRecordWatch({
    seasonYear,
    regularSeasonWeeks: season?.regularSeasonWeeks ?? 14,
    games: asOf.map((r) => ({ managerId: r.managerId, managerName: r.managerName, year: r.year, week: r.week, isPlayoff: r.isPlayoff, score: r.score, opponentScore: r.opponentScore, opponentName: r.opponentManagerName })),
    completedSeasons: completed.filter((t) => t.wins + t.losses > 0).map((t) => ({ managerName: t.manager.displayName, year: t.season.year, wins: t.wins, losses: t.losses, ties: t.ties, pointsFor: t.pointsFor })),
    currentTeams,
  })
    .slice(0, 3)
    .map((w) => ({ headline: w.headline, detail: w.detail }));

  // Best pickup: a player added this week who scored the most for his new team.
  const adds = await prisma.transactionAsset.findMany({
    where: { direction: "ADD", playerId: { not: null }, transaction: { seasonId, week, status: "COMPLETE", type: { in: ["WAIVER", "FREE_AGENT"] } } },
    select: { playerId: true, fantasyTeamId: true, manager: { select: { displayName: true } }, player: { select: { firstName: true, lastName: true } } },
  });
  const drops = await prisma.transactionAsset.findMany({
    where: { direction: "DROP", playerId: { not: null }, transaction: { seasonId, week, status: "COMPLETE" } },
    select: { playerId: true, fantasyTeamId: true, manager: { select: { displayName: true } }, player: { select: { firstName: true, lastName: true } } },
  });
  const weekScores = await prisma.weeklyPlayerScore.findMany({
    where: { roster: { week, fantasyTeam: { seasonId } }, points: { not: null }, playerId: { in: [...adds, ...drops].map((a) => a.playerId as string) } },
    select: { playerId: true, points: true, isStarter: true, roster: { select: { fantasyTeamId: true } } },
  });
  const best = adds
    .map((a) => ({ a, s: weekScores.find((w) => w.playerId === a.playerId && w.roster.fantasyTeamId === a.fantasyTeamId && w.isStarter) }))
    .filter((x) => x.s)
    .sort((x, y) => (y.s!.points ?? 0) - (x.s!.points ?? 0))[0];
  const worst = drops
    .map((d) => ({ d, s: weekScores.find((w) => w.playerId === d.playerId && w.roster.fantasyTeamId !== d.fantasyTeamId) }))
    .filter((x) => x.s)
    .sort((x, y) => (y.s!.points ?? 0) - (x.s!.points ?? 0))[0];

  return {
    season: seasonYear,
    week,
    results,
    awards: awards.map((a) => ({ award: a.label, manager: a.managerName, detail: a.description })),
    powerMovers,
    recordWatch,
    bestPickup: best?.s && best.a.manager ? { manager: best.a.manager.displayName, player: `${best.a.player?.firstName} ${best.a.player?.lastName}`, points: Math.round((best.s.points ?? 0) * 10) / 10 } : null,
    worstDrop: worst?.s && worst.d.manager ? { manager: worst.d.manager.displayName, player: `${worst.d.player?.firstName} ${worst.d.player?.lastName}`, pointsElsewhere: Math.round((worst.s.points ?? 0) * 10) / 10 } : null,
  };
}

export async function buildCatalog(options: { clock?: LeagueClock | null; kinds?: TextKind[] } = {}): Promise<TextSpec[]> {
  const { clock, season } = await currentSeasonContext(options.clock);
  if (!season || !clock) return [];
  const want = (k: TextKind) => !options.kinds || options.kinds.includes(k);
  const asOf = { season: season.year, week: clock.lastStoredWeek };
  const specs: TextSpec[] = [];
  const finalWeeks = Array.from({ length: clock.lastStoredWeek ?? 0 }, (_, i) => i + 1);

  if (want("MATCHUP_RECAP") || want("MATCHUP_PREVIEW")) {
    const previewWeeks = [...finalWeeks];
    if (
      clock.currentWeek != null &&
      clock.currentWeek !== clock.lastStoredWeek &&
      (clock.currentWeekState === "IN_PROGRESS" ||
        (clock.seasonStartDate != null && weekKickoffMs(clock.seasonStartDate, clock.currentWeek) - clock.nowMs <= PREVIEW_LEAD_MS))
    ) {
      previewWeeks.push(clock.currentWeek);
    }
    const ms = await matchupSpecs({ seasonId: season.id, recapWeeks: finalWeeks, previewWeeks });
    specs.push(...ms.filter((s) => want(s.kind)));
  }

  if (want("POWER_BLURB")) {
    const power = await getPowerRankings();
    if (power && power.seasonYear === season.year) specs.push(...powerBlurbSpecs(power));
  }

  if (want("WEEKLY_AWARDS") || want("NEWS_ISSUE")) {
    for (const week of finalWeeks) {
      if (want("WEEKLY_AWARDS")) {
        const a = awardsSpec(season.year, week, await getWeeklyAwards(season.id, week));
        if (a) specs.push(a);
      }
      if (want("NEWS_ISSUE")) specs.push(newsIssueSpec(await newsIssueFacts(season.id, season.year, week)));
    }
  }

  if (want("RIVALRY")) {
    for (const r of await getComputedRivalries()) specs.push(rivalrySpec(r, asOf));
  }

  if (want("MANAGER_BIO") || want("SCOUTING")) {
    const [rows, luck, verified] = await Promise.all([listManagerRows(), getCareerLuck(), getVerifiedRowsCached()]);
    for (const row of rows) {
      if (want("MANAGER_BIO")) specs.push(managerBioSpec(row, luck.get(row.managerId) ?? null, headToHeadLines(verified, row.managerId), asOf));
      if (want("SCOUTING")) {
        const f = await loadScoutingFacts(row.managerId, row.displayName, season.year, clock.lastStoredWeek);
        if (f) specs.push(scoutingSpec(f, asOf));
      }
    }
  }

  if (want("DRAFT_REVISIT")) {
    const provisional = await getProvisionalRevisit(season.id);
    if (provisional) {
      const [returns, grades] = await Promise.all([
        loadDraftReturns(season.id),
        prisma.draftGrade.findMany({ where: { seasonId: season.id }, select: { managerId: true, grade: true, originalScore: true } }),
      ]);
      for (const team of returns.teams) {
        const g = grades.find((x) => x.managerId === team.managerId);
        const p = provisional.byManager.get(team.managerId);
        if (!p) continue;
        specs.push(
          draftRevisitSpec(team, returns.teams.length, { grade: g?.grade ? gradeLetterToDisplay(g.grade) : null, score: g?.originalScore ?? null }, gradeLetterToDisplay(p.grade), {
            season: season.year,
            week: provisional.throughWeek,
          }),
        );
      }
    }
  }

  if (want("TRADE_VERDICT")) {
    for (const t of await getTradeTribunal()) specs.push(tradeVerdictSpec(t));
  }

  if (want("SEASON_RETRO") && clock.phase === "COMPLETE" && season.status === "COMPLETE") {
    const [champ, teams] = await Promise.all([
      prisma.championship.findFirst({
        where: { seasonId: season.id },
        select: { championManager: { select: { displayName: true } }, runnerUpFantasyTeam: { select: { manager: { select: { displayName: true } } } } },
      }),
      prisma.fantasyTeam.findMany({
        where: { seasonId: season.id },
        select: { regularSeasonRank: true, wins: true, losses: true, ties: true, pointsFor: true, manager: { select: { displayName: true } } },
        orderBy: { regularSeasonRank: "asc" },
      }),
    ]);
    if (champ) {
      const pts = [...teams].sort((a, b) => b.pointsFor - a.pointsFor)[0];
      const last = teams.at(-1);
      specs.push(
        seasonRetroSpec({
          season: season.year,
          champion: champ.championManager.displayName,
          runnerUp: champ.runnerUpFantasyTeam?.manager.displayName ?? null,
          regularSeasonWinner: teams[0]?.manager.displayName ?? null,
          pointsLeader: pts ? { manager: pts.manager.displayName, points: Math.round(pts.pointsFor * 10) / 10 } : null,
          lastPlace: last ? { manager: last.manager.displayName, record: `${last.wins}-${last.losses}` } : null,
          finalStandings: teams.map((t, i) => ({ rank: t.regularSeasonRank ?? i + 1, manager: t.manager.displayName, record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}` })),
        }),
      );
    }
  }

  return specs.sort((a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind));
}
