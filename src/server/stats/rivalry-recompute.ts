import { prisma } from "@/lib/db";
import { loadVerifiedGames, type VerifiedGameRow } from "@/server/repositories/verified-games";
import { countsForSeries, summarizeSeries } from "./head-to-head";
import type { GameResult } from "./types";

/**
 * Head-to-head statistics for every pair of managers that has met, stored in
 * Rivalry / RivalryMeeting so the rivalry pages render from a couple of
 * indexed queries.
 *
 * This used to live only in scripts/import/import-rivalries.ts, which was run
 * by hand — so the stored numbers stopped at whenever it last ran, and the
 * 2026 meetings never reached the rivalry pages (a Week 1 game shown on
 * Records was missing from the rivalry it belonged to). The weekly refresh now
 * calls recomputeRivalryStats() after every sync. The script still owns the
 * one thing that needs a human: which pairings are OFFICIAL, from the
 * commissioner's workbook.
 */


export interface Meeting {
  seasonYear: number;
  week: number;
  isPlayoff: boolean;
  isChampionship: boolean;
  /**
   * Which postseason bracket. A consolation meeting is a postseason meeting
   * and is NOT a playoff meeting — counting it as one turned toilet-bowl games
   * into "playoff history" in the rivalry write-ups.
   */
  bracketType: "WINNERS" | "CONSOLATION" | null;
  dataSource: "SLEEPER" | "ESPN" | "MANUAL";
  /** managerId -> score */
  scores: Record<string, number>;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Every counted meeting per pair, from the SAME verified rows every other
 * head-to-head surface reads (server/repositories/verified-games.ts), filtered
 * by the same rule (`countsForSeries`). Pure, so the cross-page consistency
 * test can run it on a fixture.
 */
export function meetingsFromVerifiedRows(
  rows: VerifiedGameRow[],
  championByYear: Map<number, string> = new Map(),
): Map<string, Meeting[]> {
  // Final playoff week per season — with the champion, identifies a title game
  // when the bracket's own round name is missing.
  const finalPlayoffWeek = new Map<number, number>();
  for (const r of rows) {
    if (!r.isPlayoff) continue;
    finalPlayoffWeek.set(r.year, Math.max(finalPlayoffWeek.get(r.year) ?? 0, r.week));
  }

  const seen = new Set<string>();
  const byPair = new Map<string, Meeting[]>();
  for (const r of rows) {
    if (seen.has(r.matchupId)) continue;
    seen.add(r.matchupId);
    if (!countsForSeries({ isPlayoff: r.isPlayoff, bracket: r.bracket })) continue;
    const a = r.managerId;
    const b = r.opponentManagerId;
    if (!a || !b || a === b) continue;

    const champion = championByYear.get(r.year);
    const isTitleGame =
      r.bracket === "WINNERS" && r.roundName === "Championship"
        ? true
        : r.bracket == null &&
          r.isPlayoff &&
          r.week === finalPlayoffWeek.get(r.year) &&
          champion != null &&
          (champion === a || champion === b);

    const key = pairKey(a, b);
    const list = byPair.get(key) ?? [];
    list.push({
      seasonYear: r.year,
      week: r.week,
      isPlayoff: r.isPlayoff,
      isChampionship: isTitleGame,
      bracketType: r.bracket,
      dataSource: r.dataSource as Meeting["dataSource"],
      scores: { [a]: r.score, [b]: r.opponentScore },
    });
    byPair.set(key, list);
  }
  for (const list of byPair.values()) {
    list.sort((x, y) => x.seasonYear - y.seasonYear || x.week - y.week);
  }
  return byPair;
}

export async function collectMeetings(): Promise<Map<string, Meeting[]>> {
  /*
   * Verified scores only, on BOTH sides (loadVerifiedGames enforces it). Ethan
   * Jones's three abandoned weeks in 2022 were once counted as head-to-head
   * wins for whoever happened to be scheduled against him.
   */
  const [rows, champs] = await Promise.all([
    loadVerifiedGames(),
    prisma.championship.findMany({
      select: { championManagerId: true, season: { select: { year: true } } },
    }),
  ]);
  return meetingsFromVerifiedRows(rows, new Map(champs.map((c) => [c.season.year, c.championManagerId])));
}

/** A meeting from one side's point of view, in the stats package's game shape. */
export function meetingAsGame(m: Meeting, selfId: string, opponentId: string): GameResult {
  const pf = m.scores[selfId];
  const pa = m.scores[opponentId];
  return {
    season: m.seasonYear,
    week: m.week,
    isPlayoff: m.isPlayoff,
    bracket: m.bracketType,
    pointsFor: pf,
    pointsAgainst: pa,
    opponentId,
    result: pf > pa ? "W" : pf < pa ? "L" : "T",
    dataSource: m.dataSource,
  };
}

export interface Computed {
  managerAId: string;
  managerBId: string;
  gamesPlayed: number;
  managerAWins: number;
  managerBWins: number;
  ties: number;
  managerAPoints: number;
  managerBPoints: number;
  averageMargin: number | null;
  /** Championship-bracket meetings only. */
  playoffMeetings: number;
  /** Toilet-bowl and placement meetings, counted separately. */
  consolationMeetings: number;
  championshipMeetings: number;
  closestGameMargin: number | null;
  closestGameSeason: number | null;
  largestBlowoutMargin: number | null;
  largestBlowoutManagerId: string | null;
  largestBlowoutSeason: number | null;
  currentStreakManagerId: string | null;
  currentStreakCount: number;
  longestStreakManagerId: string | null;
  longestStreakCount: number;
  lastMeetingWinnerId: string | null;
  lastMeetingSeason: number | null;
  lastMeetingWeek: number | null;
  rivalryScore: number;
  meetings: Meeting[];
}

export function computePair(aId: string, bId: string, meetings: Meeting[]): Computed {
  let playoffMeetings = 0;
  let consolationMeetings = 0;
  let championshipMeetings = 0;

  let closest: { margin: number; season: number } | null = null;
  let blowout: { margin: number; season: number; winnerId: string } | null = null;

  let curStreakId: string | null = null;
  let curStreak = 0;
  let longestId: string | null = null;
  let longest = 0;

  let lastWinnerId: string | null = null;
  let lastSeason: number | null = null;
  let lastWeek: number | null = null;

  for (const m of meetings) {
    const aScore = m.scores[aId];
    const bScore = m.scores[bId];
    const margin = Math.abs(aScore - bScore);
    // Championship bracket only. A postseason meeting with no bracket on
    // record counts as neither, rather than being assumed to be a playoff game.
    if (m.isPlayoff && m.bracketType === "WINNERS") playoffMeetings++;
    if (m.isPlayoff && m.bracketType === "CONSOLATION") consolationMeetings++;
    if (m.isChampionship) championshipMeetings++;

    const winnerId = aScore > bScore ? aId : bScore > aScore ? bId : null;

    // Ties end a streak without starting a new one.
    if (winnerId === null) {
      curStreakId = null;
      curStreak = 0;
    } else if (winnerId === curStreakId) {
      curStreak++;
    } else {
      curStreakId = winnerId;
      curStreak = 1;
    }
    if (curStreakId && curStreak > longest) {
      longest = curStreak;
      longestId = curStreakId;
    }

    if (winnerId !== null) {
      if (!closest || margin < closest.margin) closest = { margin, season: m.seasonYear };
      if (!blowout || margin > blowout.margin) blowout = { margin, season: m.seasonYear, winnerId };
    }

    lastWinnerId = winnerId;
    lastSeason = m.seasonYear;
    lastWeek = m.week;
  }

  /*
   * The headline figures come from the site's one series function, so the
   * stored rivalry can never disagree with the profile, the matchup card or the
   * AI facts. The loop above keeps only what is rivalry-specific (closest game,
   * blowout, longest streak, title meetings) and is asserted equal by the
   * cross-page consistency test.
   */
  const series = summarizeSeries(meetings.map((m) => meetingAsGame(m, aId, bId)), bId);
  const games = series.games;
  const avgMargin = series.averageMargin;
  // Closeness and postseason stakes make a rivalry; volume alone doesn't.
  const rivalryScore =
    games * 3 + playoffMeetings * 6 + championshipMeetings * 10 + Math.max(0, 25 - (avgMargin ?? 25));

  return {
    managerAId: aId,
    managerBId: bId,
    gamesPlayed: games,
    managerAWins: series.aWins,
    managerBWins: series.bWins,
    ties: series.ties,
    managerAPoints: series.aPoints,
    managerBPoints: series.bPoints,
    averageMargin: avgMargin,
    playoffMeetings: series.playoff.games,
    consolationMeetings,
    championshipMeetings,
    closestGameMargin: closest ? Number(closest.margin.toFixed(2)) : null,
    closestGameSeason: closest?.season ?? null,
    largestBlowoutMargin: blowout ? Number(blowout.margin.toFixed(2)) : null,
    largestBlowoutManagerId: blowout?.winnerId ?? null,
    largestBlowoutSeason: blowout?.season ?? null,
    currentStreakManagerId:
      series.streak.holder === "A" ? aId : series.streak.holder === "B" ? bId : null,
    currentStreakCount: series.streak.length,
    longestStreakManagerId: longestId,
    longestStreakCount: longest,
    lastMeetingWinnerId: lastWinnerId,
    lastMeetingSeason: lastSeason,
    lastMeetingWeek: lastWeek,
    rivalryScore: Number(rivalryScore.toFixed(2)),
    meetings,
  };
}

export interface RecomputeOptions {
  /**
   * Pair keys the commissioner's workbook declares official. Omit to leave
   * every existing `isOfficial` flag exactly as it is (the weekly refresh has
   * no workbook, and must not un-declare the commissioner's rivalries).
   */
  officialKeys?: Set<string>;
}

/** Recomputes and stores every pair's statistics. Returns the number of pairs written. */
export async function recomputeRivalryStats(options: RecomputeOptions = {}): Promise<number> {
  const officialKeys = options.officialKeys ?? new Set<string>();
  const haveWorkbook = options.officialKeys != null;
  const byPair = await collectMeetings();
  const allKeys = new Set<string>([...byPair.keys(), ...officialKeys]);
  let written = 0;
  for (const key of allKeys) {
    const [aId, bId] = key.split("|");
    const c = computePair(aId, bId, byPair.get(key) ?? []);
    const isOfficial = officialKeys.has(key);

    const data = {
      gamesPlayed: c.gamesPlayed,
      managerAWins: c.managerAWins,
      managerBWins: c.managerBWins,
      ties: c.ties,
      managerAPoints: c.managerAPoints,
      managerBPoints: c.managerBPoints,
      averageMargin: c.averageMargin,
      playoffMeetings: c.playoffMeetings,
      consolationMeetings: c.consolationMeetings,
      championshipMeetings: c.championshipMeetings,
      closestGameMargin: c.closestGameMargin,
      closestGameSeason: c.closestGameSeason,
      largestBlowoutMargin: c.largestBlowoutMargin,
      largestBlowoutManagerId: c.largestBlowoutManagerId,
      largestBlowoutSeason: c.largestBlowoutSeason,
      currentStreakManagerId: c.currentStreakManagerId,
      currentStreakCount: c.currentStreakCount,
      longestStreakManagerId: c.longestStreakManagerId,
      longestStreakCount: c.longestStreakCount,
      lastMeetingWinnerId: c.lastMeetingWinnerId,
      lastMeetingSeason: c.lastMeetingSeason,
      lastMeetingWeek: c.lastMeetingWeek,
      rivalryScore: c.rivalryScore,
      // Only assert official status when the workbook was actually read.
      ...(haveWorkbook ? { isOfficial } : {}),
      ...(haveWorkbook && isOfficial ? { source: "Rivalries.xlsx" } : {}),
    };

    const rivalry = await prisma.rivalry.upsert({
      where: { managerAId_managerBId: { managerAId: aId, managerBId: bId } },
      create: { managerAId: aId, managerBId: bId, ...data },
      update: data,
    });

    // Replace the meeting log wholesale — it's derived data.
    await prisma.rivalryMeeting.deleteMany({ where: { rivalryId: rivalry.id } });
    if (c.meetings.length) {
      await prisma.rivalryMeeting.createMany({
        data: c.meetings.map((m) => ({
          rivalryId: rivalry.id,
          seasonYear: m.seasonYear,
          week: m.week,
          managerAScore: m.scores[aId],
          managerBScore: m.scores[bId],
          winnerId: m.scores[aId] > m.scores[bId] ? aId : m.scores[bId] > m.scores[aId] ? bId : null,
          isPlayoff: m.isPlayoff,
          isChampionship: m.isChampionship,
          bracketType: m.bracketType,
          dataSource: m.dataSource,
        })),
      });
    }
    written++;
  }
  return written;
}
