import { prisma } from "@/lib/db";
import { cached, CACHE_TAGS } from "@/server/cache";
import { listManagerRows } from "./manager-repository";
import { getCareerLuck } from "./luck-repository";
import { loadVerifiedGames, loadVerifiedTeamWeeks } from "./verified-games";
import { getLastPlaceBySeason } from "./hall-of-shame-repository";

/**
 * The Managers page's comparison table and finish grid. Career figures are the
 * same regular-season numbers the profiles show (listManagerRows), plus PPG and
 * all-play rate from verified regular-season scores.
 */

export interface ComparisonRow {
  managerId: string;
  name: string;
  team: string;
  photoUrl: string | null;
  isActive: boolean;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  titles: number;
  finals: number;
  playoffWins: number;
  playoffLosses: number;
  ppg: number | null;
  allPlayPct: number | null;
  luck: number | null;
  luckLabel: string | null;
  lastPlaces: number;
}

export interface FinishCell {
  year: number;
  finalRank: number | null;
  teams: number;
  champion: boolean;
  lastPlace: boolean;
  current: boolean;
  record: string;
}

async function build(): Promise<{ rows: ComparisonRow[]; seasons: number[]; grid: Record<string, FinishCell[]> }> {
  const [rows, luck, games, weeks, lastPlace, teams] = await Promise.all([
    listManagerRows(),
    getCareerLuck(),
    loadVerifiedGames(),
    loadVerifiedTeamWeeks(),
    getLastPlaceBySeason(),
    prisma.fantasyTeam.findMany({
      select: { managerId: true, finalRank: true, regularSeasonRank: true, isChampion: true, wins: true, losses: true, ties: true, season: { select: { year: true, status: true } } },
    }),
  ]);

  const ppg = new Map<string, number>();
  for (const r of rows) {
    const g = games.filter((x) => x.managerId === r.managerId && !x.isPlayoff);
    if (g.length) ppg.set(r.managerId, g.reduce((s, x) => s + x.score, 0) / g.length);
  }
  // All-play: every regular-season week, each score against every other score that week.
  const byWeek = new Map<string, { managerId: string; points: number }[]>();
  for (const w of weeks) {
    if (w.isPlayoff) continue;
    const k = `${w.year}-${w.week}`;
    byWeek.set(k, [...(byWeek.get(k) ?? []), { managerId: w.managerId, points: w.points }]);
  }
  const ap = new Map<string, { w: number; n: number }>();
  for (const list of byWeek.values()) {
    for (const a of list) {
      const t = ap.get(a.managerId) ?? { w: 0, n: 0 };
      for (const b of list) {
        if (b.managerId === a.managerId) continue;
        t.n += 1;
        t.w += a.points > b.points ? 1 : a.points === b.points ? 0.5 : 0;
      }
      ap.set(a.managerId, t);
    }
  }

  const lastYears = new Map<number, string>(lastPlace.map((l) => [l.year, l.managerId]));
  const seasons = [...new Set(teams.filter((t) => t.season.status !== "UPCOMING").map((t) => t.season.year))].sort((a, b) => a - b);
  const teamsPerSeason = new Map(seasons.map((y) => [y, teams.filter((t) => t.season.year === y).length]));
  const grid: Record<string, FinishCell[]> = {};
  for (const r of rows) {
    grid[r.managerId] = seasons.map((year) => {
      const t = teams.find((x) => x.managerId === r.managerId && x.season.year === year);
      const current = t?.season.status === "IN_PROGRESS";
      return {
        year,
        finalRank: t ? (current ? null : (t.finalRank ?? t.regularSeasonRank)) : null,
        teams: teamsPerSeason.get(year) ?? 10,
        champion: !!t?.isChampion,
        lastPlace: lastYears.get(year) === r.managerId,
        current,
        record: t ? `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}` : "",
      };
    });
  }

  return {
    seasons,
    grid,
    rows: rows.map((r) => {
      const l = luck.get(r.managerId);
      const a = ap.get(r.managerId);
      return {
        managerId: r.managerId,
        name: r.displayName,
        team: r.currentTeamName,
        photoUrl: r.photoUrl,
        isActive: r.isActive,
        wins: r.careerWins,
        losses: r.careerLosses,
        ties: r.careerTies,
        winPct: r.winningPercentage,
        titles: r.championships,
        finals: r.finalsAppearances,
        playoffWins: r.playoffWins,
        playoffLosses: r.playoffLosses,
        ppg: ppg.has(r.managerId) ? Math.round((ppg.get(r.managerId) as number) * 10) / 10 : null,
        allPlayPct: a && a.n ? Math.round((a.w / a.n) * 1000) / 10 : null,
        luck: l?.score ?? null,
        luckLabel: l?.label ?? null,
        lastPlaces: r.lastPlaceFinishes,
      };
    }),
  };
}

export const getManagerComparison = cached(build, ["manager-comparison"], { tags: [CACHE_TAGS.league, CACHE_TAGS.managers] });
