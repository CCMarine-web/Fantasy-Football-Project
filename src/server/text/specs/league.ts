import { prisma } from "@/lib/db";
import { ordinal } from "@/lib/format";
import type { PowerRankingsView } from "@/server/repositories/power-rankings-repository";
import type { RivalryView } from "@/server/repositories/computed-rivalries-repository";
import type { ManagerRow, HeadToHeadLine } from "@/server/repositories/manager-repository";
import type { LuckScore } from "@/server/stats/luck";
import type { TradeTribunalView } from "@/server/repositories/trade-tribunal-repository";
import type { WeeklyAwardView } from "@/server/repositories/weekly-awards-repository";
import type { TeamDraftReturn } from "@/server/stats/draft-returns";
import type { TextSpec } from "../core";

/**
 * Fact builders for every non-matchup text. Each takes the SAME view objects
 * the page renders from, so the facts the writer saw are the numbers on the
 * page — and the page can rebuild the spec to check whether its text is
 * still current.
 */

const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);
const rec = (w: number, l: number, t = 0) => `${w}-${l}${t ? `-${t}` : ""}`;

// ── Power-ranking blurbs ──────────────────────────────────────────────────

export function powerBlurbSpecs(view: PowerRankingsView): TextSpec[] {
  if (view.mode !== "IN_SEASON") return [];
  // Each factor's league rank, so "best consistency in the league" is checkable.
  const factorRank = new Map<string, Map<string, number>>();
  for (const key of new Set(view.rows.flatMap((r) => r.factors.map((f) => f.key)))) {
    const ordered = [...view.rows]
      .map((r) => ({ id: r.fantasyTeamId, v: r.factors.find((f) => f.key === key)?.value ?? -1 }))
      .sort((a, b) => b.v - a.v);
    factorRank.set(key, new Map(ordered.map((o, i) => [o.id, i + 1])));
  }
  return view.rows.map((row) => {
    const movement =
      row.previousRank == null ? "no previous week" : row.previousRank === row.rank ? "unchanged" : row.previousRank > row.rank ? `up from ${ordinal(row.previousRank)}` : `down from ${ordinal(row.previousRank)}`;
    const facts = {
      season: view.seasonYear,
      throughWeek: view.throughWeek,
      team: row.teamName,
      manager: row.managerName,
      rank: row.rank,
      teamsRanked: view.rows.length,
      previousRank: row.previousRank,
      movement,
      powerScore: r1(row.score),
      record: row.record,
      factors: row.factors.map((f) => ({
        factor: f.label,
        stat: f.raw,
        leagueRankOnThisFactor: factorRank.get(f.key)?.get(row.fantasyTeamId) ?? null,
        relativeScore0to100: Math.round(f.value),
      })),
    };
    return {
      kind: "POWER_BLURB" as const,
      subjectKey: `${view.seasonYear}:${row.fantasyTeamId}`,
      asOfSeason: view.seasonYear,
      asOfWeek: view.throughWeek,
      facts,
      tokens: { rank: ordinal(row.rank), record: row.record, score: row.score.toFixed(1) },
      contentType: "power-ranking",
      task: `One or two sentences on why ${row.teamName} (${row.managerName}) sits where it does in the Week ${view.throughWeek} power rankings. Use "stat" for any figure; relativeScore0to100 is a 0-100 comparison score, NOT a stat — never quote it as one (a 0 there does not mean zero of anything). Only call a factor the league's best or worst when leagueRankOnThisFactor is 1 or ${view.rows.length}. Describe movement exactly as FACTS.movement says.`,
      fallback: `${row.teamName} is {{rank}} ({{record}}, power score {{score}})${row.previousRank && row.previousRank !== row.rank ? `, ${movement}` : ""}.`,
      maxWords: 55,
    };
  });
}

// ── Rivalries ─────────────────────────────────────────────────────────────

export function rivalrySpec(r: RivalryView, asOf: { season: number; week: number | null }): TextSpec {
  const nameOf = (id: string | null) => (id === r.managerAId ? r.managerAName : id === r.managerBId ? r.managerBName : null);
  const facts = {
    managers: [r.managerAName, r.managerBName],
    officialRivalry: r.isOfficial,
    series: r.seriesText,
    meetings: r.gamesPlayed,
    ties: r.ties,
    points: { [r.managerAName]: r1(r.managerAPoints), [r.managerBName]: r1(r.managerBPoints) },
    averagePerMeeting: { [r.managerAName]: r.managerAAvg, [r.managerBName]: r.managerBAvg },
    averageMargin: r1(r.averageMargin),
    playoffMeetings: r.playoffMeetings,
    titleGameMeetings: r.championshipMeetings,
    closestGame: r.closestGameMargin != null ? { margin: r.closestGameMargin, season: r.closestGameSeason } : null,
    biggestBlowout: r.largestBlowoutMargin != null ? { margin: r1(r.largestBlowoutMargin), winner: nameOf(r.largestBlowoutManagerId), season: r.largestBlowoutSeason } : null,
    currentStreak: r.currentStreakCount > 0 ? { holder: nameOf(r.currentStreakManagerId), games: r.currentStreakCount } : null,
    longestStreak: r.longestStreakCount > 0 ? { holder: nameOf(r.longestStreakManagerId), games: r.longestStreakCount } : null,
    lastMeeting: r.lastMeetingSeason ? { season: r.lastMeetingSeason, week: r.lastMeetingWeek, winner: nameOf(r.lastMeetingWinnerId) } : null,
  };
  return {
    kind: "RIVALRY",
    subjectKey: r.id,
    asOfSeason: r.lastMeetingSeason ?? asOf.season,
    asOfWeek: r.lastMeetingWeek ?? asOf.week,
    facts,
    tokens: {
      series: r.seriesText,
      meetings: String(r.gamesPlayed),
      streak: facts.currentStreak ? `${facts.currentStreak.holder} has won ${facts.currentStreak.games} straight` : "nobody has a streak going",
    },
    contentType: "rivalry",
    task: `Write the head-to-head story of ${r.managerAName} vs ${r.managerBName}: who owns it, how close it has been, the moment that defines it, and where it stands now. Three to four sentences.`,
    fallback: `{{series}} across {{meetings}} meetings; ${facts.currentStreak ? "{{streak}}" : "neither side has a streak going"}.`,
    maxWords: 95,
  };
}

// ── Manager bios ──────────────────────────────────────────────────────────

export function managerBioSpec(
  row: ManagerRow,
  luck: LuckScore | null,
  h2h: HeadToHeadLine[],
  asOf: { season: number; week: number | null },
): TextSpec {
  const meaningful = h2h.filter((l) => l.games >= 8);
  const best = [...meaningful].sort((a, b) => b.wins / b.games - a.wins / a.games)[0];
  const worst = [...meaningful].sort((a, b) => a.wins / a.games - b.wins / b.games)[0];
  const careerRecord = rec(row.careerWins, row.careerLosses, row.careerTies);
  const facts = {
    manager: row.displayName,
    currentTeam: row.currentTeamName,
    yearsActive: row.yearsActive,
    seasons: row.seasonsPlayed,
    careerRegularSeasonRecord: careerRecord,
    winPct: Number((row.winningPercentage * 100).toFixed(1)),
    championshipBracketRecord: rec(row.playoffWins, row.playoffLosses),
    titles: row.championships,
    finalsAppearances: row.finalsAppearances,
    bestFinish: row.bestFinish,
    lastPlaceFinishes: row.lastPlaceFinishes,
    lastPlaceYears: row.lastPlaceYears,
    currentSeasonRecord: rec(row.currentWins, row.currentLosses, row.currentTies),
    luckScore: luck?.score ?? null,
    luckLabel: luck?.label ?? null,
    bestHeadToHead: best ? { opponent: best.opponentName, record: rec(best.wins, best.losses, best.ties) } : null,
    worstHeadToHead: worst ? { opponent: worst.opponentName, record: rec(worst.wins, worst.losses, worst.ties) } : null,
  };
  return {
    kind: "MANAGER_BIO",
    subjectKey: row.managerId,
    asOfSeason: asOf.season,
    asOfWeek: asOf.week,
    facts,
    tokens: {
      record: careerRecord,
      titles: String(row.championships),
      finals: String(row.finalsAppearances),
      luck: luck?.score != null ? String(luck.score) : "not measured",
      current: facts.currentSeasonRecord,
    },
    contentType: "manager-profile",
    task: `Write ${row.displayName}'s league bio: who they are as a manager, their career arc, titles and finals, how this season is going, and one rivalry worth mentioning. "Finals appearances" already includes title wins — never add them together or describe them as two different things. Three to five sentences; it must stand on its own as a card summary.`,
    fallback: `${row.displayName} has a {{record}} regular-season record over ${row.seasonsPlayed} seasons, with {{titles}} title${row.championships === 1 ? "" : "s"} in {{finals}} finals. This season: {{current}}. Luck Score: {{luck}}${luck?.label ? ` (${luck.label})` : ""}.`,
    maxWords: 150,
  };
}

// ── Scouting reports ──────────────────────────────────────────────────────

export interface ScoutingFacts {
  managerId: string;
  managerName: string;
  completedSeasonsRecord: string;
  titles: number;
  bestFinish: number | null;
  worstFinish: number | null;
  trades: number;
  waiverClaims: number;
  freeAgentPickups: number;
  firstRoundPicks: Record<string, number>;
}

export async function loadScoutingFacts(managerId: string, managerName: string, throughSeason: number, throughWeek: number | null): Promise<ScoutingFacts | null> {
  const [assets, r1picks, teams] = await Promise.all([
    prisma.transactionAsset.findMany({
      where: {
        managerId,
        direction: "ADD",
        transaction: {
          status: "COMPLETE",
          // Through the last completed week, so a mid-week waiver doesn't
          // invalidate the report every day.
          OR: [{ season: { year: { lt: throughSeason } } }, { season: { year: throughSeason }, week: { lte: throughWeek ?? 0 } }],
        },
      },
      select: { transactionId: true, transaction: { select: { type: true } } },
    }),
    prisma.draftPick.findMany({ where: { managerId, round: 1 }, select: { player: { select: { position: true } } } }),
    prisma.fantasyTeam.findMany({
      where: { managerId, season: { status: "COMPLETE" } },
      select: { finalRank: true, isChampion: true, wins: true, losses: true, ties: true },
    }),
  ]);
  if (assets.length === 0 && r1picks.length === 0 && teams.length === 0) return null;
  const finishes = teams.map((t) => t.finalRank).filter((x): x is number => x != null);
  const firstRoundPicks: Record<string, number> = {};
  for (const p of r1picks) {
    const pos = p.player?.position ?? "?";
    firstRoundPicks[pos] = (firstRoundPicks[pos] ?? 0) + 1;
  }
  return {
    managerId,
    managerName,
    completedSeasonsRecord: rec(
      teams.reduce((s, t) => s + t.wins, 0),
      teams.reduce((s, t) => s + t.losses, 0),
      teams.reduce((s, t) => s + t.ties, 0),
    ),
    titles: teams.filter((t) => t.isChampion).length,
    bestFinish: finishes.length ? Math.min(...finishes) : null,
    worstFinish: finishes.length ? Math.max(...finishes) : null,
    trades: new Set(assets.filter((a) => a.transaction.type === "TRADE").map((a) => a.transactionId)).size,
    waiverClaims: assets.filter((a) => a.transaction.type === "WAIVER").length,
    freeAgentPickups: assets.filter((a) => a.transaction.type === "FREE_AGENT").length,
    firstRoundPicks,
  };
}

export function scoutingSpec(f: ScoutingFacts, asOf: { season: number; week: number | null }): TextSpec {
  return {
    kind: "SCOUTING",
    subjectKey: f.managerId,
    asOfSeason: asOf.season,
    asOfWeek: asOf.week,
    facts: { ...f, managerId: undefined },
    tokens: { record: f.completedSeasonsRecord },
    contentType: "scouting-report",
    task: `A scouting report on ${f.managerName} for an opponent: how they build rosters (draft habits from firstRoundPicks, trades vs waiver claims vs free-agent pickups) and what to expect. Three sentences.`,
    fallback: `${f.managerName}: ${f.trades} trade${f.trades === 1 ? "" : "s"}, ${f.waiverClaims} waiver claims and ${f.freeAgentPickups} free-agent pickups on record; {{record}} in completed seasons.`,
    maxWords: 80,
  };
}

// ── Draft revisit (Sleeper seasons, weekly) ───────────────────────────────

export function draftRevisitSpec(
  team: TeamDraftReturn,
  teamsGraded: number,
  original: { grade: string | null; score: number | null },
  provisionalGrade: string,
  asOf: { season: number; week: number },
): TextSpec {
  const facts = {
    season: asOf.season,
    throughWeek: asOf.week,
    manager: team.managerName,
    draftDayGrade: original.grade,
    draftDayScore: r1(original.score),
    revisitedGradeSoFar: provisionalGrade,
    draftReturnsRank: team.rank,
    teams: teamsGraded,
    factors: team.factors.map((f) => ({ factor: f.label, stat: f.raw })),
    bestPicks: team.bestPicks.slice(0, 3).map((p) => ({ player: p.playerName, round: p.round, pointsPerGame: r1(p.pointsPerGame) })),
    worstPicks: team.worstPicks.slice(0, 2).map((p) => ({ player: p.playerName, round: p.round, pointsPerGame: r1(p.pointsPerGame), gamesPlayed: p.gamesPlayed })),
  };
  return {
    kind: "DRAFT_REVISIT",
    subjectKey: `${asOf.season}:${team.managerId}`,
    asOfSeason: asOf.season,
    asOfWeek: asOf.week,
    facts,
    tokens: { grade: provisionalGrade, rank: `${ordinal(team.rank)} of ${teamsGraded}` },
    contentType: "draft-grade",
    task: `Revisit ${team.managerName}'s ${asOf.season} draft through Week ${asOf.week}: how the draft-day grade is holding up, the picks that are paying off and the ones that aren't. This is provisional — the season isn't over. Two to three sentences.`,
    fallback: `Through Week ${asOf.week}, ${team.managerName}'s draft rates {{grade}} in hindsight ({{rank}} in draft returns)${team.bestPicks[0] ? `, led by ${team.bestPicks[0].playerName}` : ""}.`,
    maxWords: 75,
  };
}

// ── Trade verdicts ────────────────────────────────────────────────────────

export function tradeVerdictSpec(t: TradeTribunalView): TextSpec {
  const facts = {
    season: t.seasonYear,
    week: t.week,
    sides: t.sides.map((s) => ({ manager: s.managerName, received: s.acquired, unpricedAssets: s.unpricedAssets, valueAboveReplacement: r1(s.value) })),
    winner: t.winnerName,
    lopsidedness: t.lopsidedness,
    provisional: t.provisional,
    confidence: t.confidence,
    hindsight: t.hindsightSummary,
  };
  return {
    kind: "TRADE_VERDICT",
    subjectKey: t.transactionId,
    asOfSeason: t.seasonYear,
    asOfWeek: t.week,
    facts,
    tokens: { winner: t.winnerName ?? "neither side" },
    contentType: "trade-verdict",
    task: `Rule on this trade like a judge with a grudge: who won (FACTS.winner) and by how much, in plain terms.${t.provisional ? " The season is still being played, so the ruling is provisional — say so." : ""} Two sentences.`,
    fallback: t.winnerName ? `{{winner}} wins this one${t.provisional ? " (provisional — the season isn't over)" : ""}. ${t.hindsightSummary}` : t.hindsightSummary,
    maxWords: 60,
  };
}

// ── Weekly awards copy ────────────────────────────────────────────────────

export function awardsSpec(seasonYear: number, week: number, awards: WeeklyAwardView[]): TextSpec | null {
  if (awards.length === 0) return null;
  const facts = { season: seasonYear, week, awards: awards.map((a) => ({ award: a.label, manager: a.managerName, value: r1(a.value), detail: a.description })) };
  return {
    kind: "WEEKLY_AWARDS",
    subjectKey: `${seasonYear}:${week}`,
    asOfSeason: seasonYear,
    asOfWeek: week,
    facts,
    tokens: {},
    contentType: "weekly-awards",
    task: `Present the Week ${week} awards in one punchy paragraph — one line per award, naming the winner and why.`,
    fallback: awards.map((a) => `${a.label}: ${a.managerName}. ${a.description}`).join(" "),
    maxWords: 120,
  };
}

// ── The weekly news issue ─────────────────────────────────────────────────

export interface NewsIssueFacts {
  season: number;
  week: number;
  results: { winner: string; loser: string; winnerScore: number; loserScore: number; result: string }[];
  awards: { award: string; manager: string; detail: string }[];
  powerMovers: { team: string; manager: string; from: number; to: number }[];
  recordWatch: { headline: string; detail: string }[];
  bestPickup: { manager: string; player: string; points: number } | null;
  worstDrop: { manager: string; player: string; pointsElsewhere: number } | null;
}

export function newsIssueSpec(f: NewsIssueFacts): TextSpec {
  return {
    kind: "NEWS_ISSUE",
    subjectKey: `${f.season}:${f.week}`,
    asOfSeason: f.season,
    asOfWeek: f.week,
    facts: f as unknown as Record<string, unknown>,
    tokens: {},
    contentType: "season-summary",
    task: `Write this week's issue of The Rat Trap's league newspaper for Week ${f.week}, ${f.season}: a lead story from the results (call upsets upsets only where result says "upset"), the awards, power-ranking movers, the record watch, and the best and worst roster moves. Four short paragraphs separated by blank lines.`,
    fallback: [
      `Week ${f.week} results: ${f.results.map((r) => `${r.winner} ${r.winnerScore.toFixed(1)}–${r.loserScore.toFixed(1)} ${r.loser}`).join("; ")}.`,
      f.awards.length ? f.awards.map((a) => `${a.award}: ${a.manager}.`).join(" ") : "",
      f.powerMovers.length ? `Movers: ${f.powerMovers.map((m) => `${m.team} ${ordinal(m.from)} → ${ordinal(m.to)}`).join(", ")}.` : "",
      f.recordWatch.length ? `Record watch: ${f.recordWatch.map((r) => r.headline).join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxWords: 320,
  };
}

// ── Season retrospective ──────────────────────────────────────────────────

export function seasonRetroSpec(f: {
  season: number;
  champion: string;
  runnerUp: string | null;
  regularSeasonWinner: string | null;
  pointsLeader: { manager: string; points: number } | null;
  lastPlace: { manager: string; record: string } | null;
  finalStandings: { rank: number; manager: string; record: string }[];
}): TextSpec {
  return {
    kind: "SEASON_RETRO",
    subjectKey: String(f.season),
    asOfSeason: f.season,
    asOfWeek: null,
    facts: f,
    tokens: { champion: f.champion },
    contentType: "season-summary",
    task: `Write the ${f.season} season retrospective: the champion's run, the regular season's story, the points leader, and who finished last. Three short paragraphs.`,
    fallback: `{{champion}} won the ${f.season} title${f.runnerUp ? ` over ${f.runnerUp}` : ""}.${f.lastPlace ? ` ${f.lastPlace.manager} finished last at ${f.lastPlace.record}.` : ""}`,
    maxWords: 260,
  };
}
