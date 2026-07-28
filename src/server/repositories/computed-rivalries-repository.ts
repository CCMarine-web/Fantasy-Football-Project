import { prisma } from "@/lib/db";

/**
 * Rivalries, read straight from the persisted Rivalry / RivalryMeeting tables.
 *
 * This used to recompute every head-to-head pairing from raw MatchupTeam rows
 * on each request AND call the model once per pairing — O(n²) LLM calls per
 * page view. Now scripts/import/import-rivalries.ts computes and stores the
 * numbers (from verified results only, with the commissioner's workbook naming
 * the official pairings) and scripts/ai/backfill-blurbs.ts writes the
 * commentary. Rendering is a couple of indexed queries.
 */

export interface RivalryMeetingView {
  seasonYear: number;
  week: number;
  managerAScore: number;
  managerBScore: number;
  winnerId: string | null;
  isPlayoff: boolean;
  isChampionship: boolean;
  bracketType: "WINNERS" | "CONSOLATION" | null;
}

export interface RivalryView {
  id: string;
  isOfficial: boolean;
  managerAId: string;
  managerAName: string;
  managerAPhoto: string | null;
  managerBId: string;
  managerBName: string;
  managerBPhoto: string | null;
  gamesPlayed: number;
  managerAWins: number;
  managerBWins: number;
  ties: number;
  managerAPoints: number;
  managerBPoints: number;
  managerAAvg: number | null;
  managerBAvg: number | null;
  averageMargin: number | null;
  /** Championship-bracket meetings only. */
  playoffMeetings: number;
  /** Toilet-bowl and placement meetings — postseason, but not playoff games. */
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
  /** Persisted commentary, or null when none has been generated yet. */
  blurb: string | null;
  meetings: RivalryMeetingView[];
}

const SELECT = {
  id: true,
  isOfficial: true,
  managerAId: true,
  managerBId: true,
  gamesPlayed: true,
  managerAWins: true,
  managerBWins: true,
  ties: true,
  managerAPoints: true,
  managerBPoints: true,
  averageMargin: true,
  playoffMeetings: true,
  consolationMeetings: true,
  championshipMeetings: true,
  closestGameMargin: true,
  closestGameSeason: true,
  largestBlowoutMargin: true,
  largestBlowoutManagerId: true,
  largestBlowoutSeason: true,
  currentStreakManagerId: true,
  currentStreakCount: true,
  longestStreakManagerId: true,
  longestStreakCount: true,
  lastMeetingWinnerId: true,
  lastMeetingSeason: true,
  lastMeetingWeek: true,
  rivalryScore: true,
  summary: true,
  summaryIsMock: true,
  managerA: { select: { displayName: true, photoUrl: true, avatarUrl: true } },
  managerB: { select: { displayName: true, photoUrl: true, avatarUrl: true } },
} as const;

type RivalryRow = Awaited<ReturnType<typeof fetchRivalries>>[number];

async function fetchRivalries(where: { isOfficial?: boolean; id?: string }) {
  return prisma.rivalry.findMany({
    where: { ...where, gamesPlayed: { gt: 0 } },
    select: SELECT,
    orderBy: [{ isOfficial: "desc" }, { rivalryScore: "desc" }],
  });
}

function toView(r: RivalryRow, meetings: RivalryMeetingView[] = []): RivalryView {
  const games = r.gamesPlayed || 0;
  return {
    id: r.id,
    isOfficial: r.isOfficial,
    managerAId: r.managerAId,
    managerAName: r.managerA.displayName,
    managerAPhoto: r.managerA.photoUrl ?? r.managerA.avatarUrl ?? null,
    managerBId: r.managerBId,
    managerBName: r.managerB.displayName,
    managerBPhoto: r.managerB.photoUrl ?? r.managerB.avatarUrl ?? null,
    gamesPlayed: games,
    managerAWins: r.managerAWins,
    managerBWins: r.managerBWins,
    ties: r.ties,
    managerAPoints: r.managerAPoints,
    managerBPoints: r.managerBPoints,
    managerAAvg: games ? Number((r.managerAPoints / games).toFixed(1)) : null,
    managerBAvg: games ? Number((r.managerBPoints / games).toFixed(1)) : null,
    averageMargin: r.averageMargin,
    playoffMeetings: r.playoffMeetings,
    consolationMeetings: r.consolationMeetings,
    championshipMeetings: r.championshipMeetings,
    closestGameMargin: r.closestGameMargin,
    closestGameSeason: r.closestGameSeason,
    largestBlowoutMargin: r.largestBlowoutMargin,
    largestBlowoutManagerId: r.largestBlowoutManagerId,
    largestBlowoutSeason: r.largestBlowoutSeason,
    currentStreakManagerId: r.currentStreakManagerId,
    currentStreakCount: r.currentStreakCount,
    longestStreakManagerId: r.longestStreakManagerId,
    longestStreakCount: r.longestStreakCount,
    lastMeetingWinnerId: r.lastMeetingWinnerId,
    lastMeetingSeason: r.lastMeetingSeason,
    lastMeetingWeek: r.lastMeetingWeek,
    rivalryScore: r.rivalryScore,
    // Never surface placeholder copy.
    blurb: r.summary && !r.summaryIsMock ? r.summary : null,
    meetings,
  };
}

/** Official (commissioner-declared) rivalries, strongest first. */
export async function getOfficialRivalries(): Promise<RivalryView[]> {
  const rows = await fetchRivalries({ isOfficial: true });
  return rows.map((r) => toView(r));
}

/** Every pairing that has met, official first then by rivalry score. */
export async function getComputedRivalries(): Promise<RivalryView[]> {
  const rows = await fetchRivalries({});
  return rows.map((r) => toView(r));
}

/** One rivalry with its full season-by-season meeting log. */
export async function getRivalryDetail(id: string): Promise<RivalryView | null> {
  const [row] = await fetchRivalries({ id });
  if (!row) return null;
  const meetings = await prisma.rivalryMeeting.findMany({
    where: { rivalryId: id },
    orderBy: [{ seasonYear: "desc" }, { week: "desc" }],
    select: {
      seasonYear: true,
      week: true,
      managerAScore: true,
      managerBScore: true,
      winnerId: true,
      isPlayoff: true,
      isChampionship: true,
      bracketType: true,
    },
  });
  return toView(row, meetings);
}

/** Rivalry records involving one manager — used on the manager profile. */
export async function getRivalriesForManager(managerId: string): Promise<RivalryView[]> {
  const rows = await prisma.rivalry.findMany({
    where: { gamesPlayed: { gt: 0 }, OR: [{ managerAId: managerId }, { managerBId: managerId }] },
    select: SELECT,
    orderBy: [{ isOfficial: "desc" }, { rivalryScore: "desc" }],
  });
  return rows.map((r) => toView(r));
}
