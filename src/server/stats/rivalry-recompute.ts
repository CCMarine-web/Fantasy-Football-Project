import { prisma } from "@/lib/db";

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

export async function collectMeetings(): Promise<Map<string, Meeting[]>> {
  /*
   * Verified scores only, on BOTH sides. Ethan Jones's three abandoned weeks in
   * 2022 were counted as head-to-head wins for whoever happened to be scheduled
   * against him, which inflated their records, their points totals and their
   * biggest-win margins, and put a 100-point "blowout" at the top of two
   * rivalry pages. See scripts/import/audit-suspect-scores.ts.
   */
  const rows = await prisma.matchupTeam.findMany({
    where: { score: { not: null }, verifiedScore: true },
    select: {
      score: true,
      fantasyTeam: { select: { managerId: true } },
      matchup: {
        select: {
          id: true,
          week: true,
          isPlayoff: true,
          bracketType: true,
          roundName: true,
          season: { select: { year: true, dataSource: true } },
          teams: {
            select: {
              score: true,
              verifiedScore: true,
              fantasyTeam: { select: { managerId: true } },
            },
          },
        },
      },
    },
  });

  // Champion per season, plus the final playoff week per season — together
  // these identify a title game without inventing bracket data we don't have.
  const champs = await prisma.championship.findMany({
    select: { championManagerId: true, season: { select: { year: true } } },
  });
  const championByYear = new Map(champs.map((c) => [c.season.year, c.championManagerId]));

  const finalPlayoffWeek = new Map<number, number>();
  for (const r of rows) {
    if (!r.matchup.isPlayoff) continue;
    const y = r.matchup.season.year;
    finalPlayoffWeek.set(y, Math.max(finalPlayoffWeek.get(y) ?? 0, r.matchup.week));
  }

  const seen = new Set<string>();
  const byPair = new Map<string, Meeting[]>();

  for (const r of rows) {
    const m = r.matchup;
    if (m.teams.length !== 2) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);

    // Consolation-bracket meetings decide nothing and are not counted
    // anywhere else on the site; a rivalry record including them disagreed
    // with the same pairing's head-to-head on the manager pages.
    if (m.isPlayoff && m.bracketType === "CONSOLATION") continue;

    const [t1, t2] = m.teams;
    const a = t1.fantasyTeam.managerId;
    const b = t2.fantasyTeam.managerId;
    if (!a || !b || a === b) continue;
    if (t1.score == null || t2.score == null) continue;
    // A contest needs two real results. Filtering only the queried side left
    // the opponent's row in, so the abandoned team still appeared as a loss.
    if (!t1.verifiedScore || !t2.verifiedScore) continue;

    const year = m.season.year;
    const champion = championByYear.get(year);
    /*
     * Prefer the bracket's own designation. The old heuristic — last playoff
     * week, champion involved — also matched the third-place game and any
     * consolation game played that week, so a toilet-bowl meeting could be
     * recorded as a championship meeting.
     */
    const isTitleGame =
      m.bracketType === "WINNERS" && m.roundName === "Championship"
        ? true
        : m.bracketType == null &&
          m.isPlayoff &&
          m.week === finalPlayoffWeek.get(year) &&
          champion != null &&
          (champion === a || champion === b);

    const key = pairKey(a, b);
    const list = byPair.get(key) ?? [];
    list.push({
      seasonYear: year,
      week: m.week,
      isPlayoff: m.isPlayoff,
      isChampionship: isTitleGame,
      bracketType: m.bracketType,
      dataSource: m.season.dataSource as Meeting["dataSource"],
      scores: { [a]: t1.score, [b]: t2.score },
    });
    byPair.set(key, list);
  }

  for (const list of byPair.values()) {
    list.sort((x, y) => x.seasonYear - y.seasonYear || x.week - y.week);
  }
  return byPair;
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
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  let aPoints = 0;
  let bPoints = 0;
  let marginSum = 0;
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
    aPoints += aScore;
    bPoints += bScore;
    const margin = Math.abs(aScore - bScore);
    marginSum += margin;
    // Championship bracket only. A postseason meeting with no bracket on
    // record counts as neither, rather than being assumed to be a playoff game.
    if (m.isPlayoff && m.bracketType === "WINNERS") playoffMeetings++;
    if (m.isPlayoff && m.bracketType === "CONSOLATION") consolationMeetings++;
    if (m.isChampionship) championshipMeetings++;

    const winnerId = aScore > bScore ? aId : bScore > aScore ? bId : null;
    if (winnerId === aId) aWins++;
    else if (winnerId === bId) bWins++;
    else ties++;

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

  const games = meetings.length;
  const avgMargin = games ? marginSum / games : null;
  // Closeness and postseason stakes make a rivalry; volume alone doesn't.
  const rivalryScore =
    games * 3 + playoffMeetings * 6 + championshipMeetings * 10 + Math.max(0, 25 - (avgMargin ?? 25));

  return {
    managerAId: aId,
    managerBId: bId,
    gamesPlayed: games,
    managerAWins: aWins,
    managerBWins: bWins,
    ties,
    managerAPoints: Number(aPoints.toFixed(2)),
    managerBPoints: Number(bPoints.toFixed(2)),
    averageMargin: avgMargin == null ? null : Number(avgMargin.toFixed(2)),
    playoffMeetings,
    consolationMeetings,
    championshipMeetings,
    closestGameMargin: closest ? Number(closest.margin.toFixed(2)) : null,
    closestGameSeason: closest?.season ?? null,
    largestBlowoutMargin: blowout ? Number(blowout.margin.toFixed(2)) : null,
    largestBlowoutManagerId: blowout?.winnerId ?? null,
    largestBlowoutSeason: blowout?.season ?? null,
    currentStreakManagerId: curStreak > 0 ? curStreakId : null,
    currentStreakCount: curStreak,
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
