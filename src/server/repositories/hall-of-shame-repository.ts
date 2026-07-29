import { prisma } from "@/lib/db";
import { longestLosingStreak } from "@/server/stats";
import type { GameResult } from "@/server/stats/types";
import {
  findLastPlace,
  formatRecord,
  type LastPlaceFinish,
  type SeasonStandingTeam,
} from "@/server/stats/last-place";
import { countExcludedScores, loadVerifiedGames } from "./verified-games";
import { cached, CACHE_TAGS } from "@/server/cache";

export interface ShameEntry {
  key: string;
  label: string;
  value: string;
  holderName: string;
  holderManagerId: string | null;
  detail: string;
}

export interface PunishmentPhoto {
  id: string;
  year: number;
  managerId: string | null;
  managerName: string | null;
  description: string | null;
  photoUrl: string;
}

export interface HallOfShame {
  entries: ShameEntry[];
  /** Season-by-season regular-season last place, newest first. */
  lastPlace: LastPlaceFinish[];
  /** Published punishment photographs, newest season first. */
  punishmentPhotos: PunishmentPhoto[];
  /** Recorded punishments with no photograph — still part of the record. */
  punishmentsWithoutPhotos: PunishmentPhoto[];
  benchYearsCovered: number[]; // seasons that have player-level data for bench calc
  allYears: number[];
  /**
   * Scores left out because they could not be verified as real contest results.
   * Surfaced so the page can say so rather than silently dropping them.
   * See scripts/import/audit-suspect-scores.ts.
   */
  excludedScores: number;
  /** True when any listed season fell back to record-and-points for last place. */
  usesFallbackTiebreak: boolean;
}

/**
 * The inverse of the record books.
 *
 * ── Last place ────────────────────────────────────────────────────────────
 * Read off the REGULAR-SEASON standings, never the consolation bracket. See
 * server/stats/last-place.ts for why. Nothing on this page is decided by a
 * Toilet Bowl result.
 *
 * ── Which games count ─────────────────────────────────────────────────────
 * Only verified ones, from loadVerifiedGames(): a manager who stopped setting a
 * lineup posted three 0.0s, and putting those at the top of the Hall of Shame
 * mistakes an abandoned team for a bad week.
 *
 * Bench points ("most left on the bench") needs player-level data, which only
 * exists for seasons synced after that feature landed — those seasons are
 * flagged in `benchYearsCovered`, and the entry notes the coverage.
 */
export const getHallOfShame = cached(buildHallOfShame, ["hall-of-shame"], {
  tags: [CACHE_TAGS.league, CACHE_TAGS.managers],
});

async function buildHallOfShame(): Promise<HallOfShame> {
  const games = await loadVerifiedGames();
  const allYearsSet = new Set(games.map((g) => g.year));

  const entries: ShameEntry[] = [];
  if (games.length > 0) {
    const where = (g: (typeof games)[number]) => `Week ${g.week}, ${g.year}`;

    const lowest = games.reduce((a, b) => (b.score < a.score ? b : a));
    entries.push({
      key: "low-game",
      label: "Lowest Single-Game Score",
      value: lowest.score.toFixed(1),
      holderName: lowest.managerName,
      holderManagerId: lowest.managerId,
      detail: `vs ${lowest.opponentManagerName} · ${where(lowest)}`,
    });

    const wins = games.filter((g) => g.isWinner === true);
    if (wins.length) {
      const lw = wins.reduce((a, b) => (b.score < a.score ? b : a));
      entries.push({
        key: "low-win",
        label: "Lowest Score in a Win (Backed In)",
        value: lw.score.toFixed(1),
        holderName: lw.managerName,
        holderManagerId: lw.managerId,
        detail: `won ${lw.score.toFixed(1)}–${lw.opponentScore.toFixed(1)} · ${where(lw)}`,
      });
    }

    // Worst blowout loss (from the loser's perspective).
    const losses = games.filter((g) => g.isWinner === false);
    if (losses.length) {
      const worstLoss = losses.reduce((a, b) =>
        b.opponentScore - b.score > a.opponentScore - a.score ? b : a,
      );
      entries.push({
        key: "worst-loss",
        label: "Worst Blowout Loss",
        value: `${(worstLoss.opponentScore - worstLoss.score).toFixed(1)} pts`,
        holderName: worstLoss.managerName,
        holderManagerId: worstLoss.managerId,
        detail: `lost ${worstLoss.score.toFixed(1)}–${worstLoss.opponentScore.toFixed(1)} to ${worstLoss.opponentManagerName} · ${where(worstLoss)}`,
      });
    }

    // Longest losing streak all-time.
    const logByManager = new Map<string, { name: string; games: GameResult[] }>();
    for (const g of games) {
      const e = logByManager.get(g.managerId) ?? { name: g.managerName, games: [] };
      e.games.push({
        week: g.week,
        season: g.year,
        isPlayoff: g.isPlayoff,
        pointsFor: g.score,
        pointsAgainst: g.opponentScore,
        opponentId: g.opponentManagerId,
        result: g.isWinner === true ? "W" : g.isWinner === false ? "L" : "T",
      });
      logByManager.set(g.managerId, e);
    }
    let worstStreak = { id: "", name: "", len: 0 };
    for (const [id, e] of logByManager) {
      const l = longestLosingStreak(e.games);
      if (l > worstStreak.len) worstStreak = { id, name: e.name, len: l };
    }
    if (worstStreak.len) {
      entries.push({
        key: "loss-streak",
        label: "Longest Losing Streak",
        value: `${worstStreak.len} games`,
        holderName: worstStreak.name,
        holderManagerId: worstStreak.id,
        detail: "all-time",
      });
    }
  }

  // Worst season record.
  const teams = await prisma.fantasyTeam.findMany({
    where: { OR: [{ wins: { gt: 0 } }, { losses: { gt: 0 } }, { pointsFor: { gt: 0 } }] },
    include: {
      manager: { select: { id: true, displayName: true } },
      season: { select: { year: true, status: true } },
    },
  });
  if (teams.length) {
    const pct = (t: (typeof teams)[number]) => {
      const g = t.wins + t.losses + t.ties;
      return g ? (t.wins + 0.5 * t.ties) / g : 1;
    };
    const worst = teams.reduce((a, b) => (pct(b) < pct(a) ? b : a));
    entries.push({
      key: "worst-season",
      label: "Worst Season Ever",
      value: formatRecord(worst),
      holderName: worst.manager.displayName,
      holderManagerId: worst.manager.id,
      detail: `${worst.season.year} · ${worst.pointsFor.toFixed(0)} PF`,
    });
  }

  // Most points left on the bench (needs player-level data).
  const rosters = await prisma.roster.findMany({
    include: {
      fantasyTeam: {
        select: {
          manager: { select: { id: true, displayName: true } },
          season: { select: { year: true } },
        },
      },
      playerScores: { select: { isStarter: true, points: true } },
    },
  });
  const benchYears = new Set<number>();
  let worstBench: {
    value: number;
    managerId: string;
    managerName: string;
    year: number;
    week: number;
  } | null = null;
  for (const roster of rosters) {
    if (roster.playerScores.length === 0) continue;
    // ESPN-era rosters record who was on the team but no trustworthy per-week
    // score (points is null). Reading those as zero would make every ESPN
    // roster look like a total lineup failure, so skip any roster that isn't
    // fully scored rather than compare incomparable numbers.
    const scored = roster.playerScores.filter(
      (p): p is typeof p & { points: number } => p.points != null,
    );
    if (scored.length !== roster.playerScores.length) continue;
    benchYears.add(roster.fantasyTeam.season.year);
    const starters = scored.filter((p) => p.isStarter);
    const starterCount = starters.length || 9;
    const actualStarterPts = starters.reduce((a, p) => a + p.points, 0);
    // Optimal (position-agnostic): best `starterCount` scorers on the roster.
    const optimalPts = [...scored]
      .sort((a, b) => b.points - a.points)
      .slice(0, starterCount)
      .reduce((a, p) => a + p.points, 0);
    const left = optimalPts - actualStarterPts;
    if (!worstBench || left > worstBench.value) {
      worstBench = {
        value: left,
        managerId: roster.fantasyTeam.manager.id,
        managerName: roster.fantasyTeam.manager.displayName,
        year: roster.fantasyTeam.season.year,
        week: roster.week,
      };
    }
  }
  if (worstBench && worstBench.value > 0) {
    entries.push({
      key: "bench",
      label: "Most Points Left on the Bench",
      value: `${worstBench.value.toFixed(1)} pts`,
      holderName: worstBench.managerName,
      holderManagerId: worstBench.managerId,
      detail: `Week ${worstBench.week}, ${worstBench.year}`,
    });
  }

  const lastPlace = await getLastPlaceBySeason();
  const [photos, excludedScores] = await Promise.all([
    listPunishmentPhotos(),
    countExcludedScores(),
  ]);

  return {
    entries,
    lastPlace,
    punishmentPhotos: photos.filter((p): p is PunishmentPhoto => p.photoUrl != null),
    punishmentsWithoutPhotos: photos.filter((p) => p.photoUrl == null) as PunishmentPhoto[],
    benchYearsCovered: [...benchYears].sort((a, b) => a - b),
    allYears: [...allYearsSet].sort((a, b) => a - b),
    excludedScores,
    usesFallbackTiebreak: lastPlace.some((l) => l.basis === "POINTS_FALLBACK"),
  };
}

/**
 * Regular-season last place for every season with played games, newest first.
 *
 * Shared by the Hall of Shame, the season history pages, the manager profiles
 * and the AI research packets, so all of them name the same person.
 */
export const getLastPlaceBySeason = cached(buildLastPlaceBySeason, ["last-place-by-season"], {
  tags: [CACHE_TAGS.league],
});

async function buildLastPlaceBySeason(): Promise<LastPlaceFinish[]> {
  const teams = await prisma.fantasyTeam.findMany({
    where: { season: { status: { not: "UPCOMING" } } },
    select: {
      teamName: true,
      wins: true,
      losses: true,
      ties: true,
      pointsFor: true,
      pointsAgainst: true,
      regularSeasonRank: true,
      managerId: true,
      manager: { select: { displayName: true } },
      season: { select: { year: true } },
    },
  });

  const byYear = new Map<number, SeasonStandingTeam[]>();
  for (const t of teams) {
    const list = byYear.get(t.season.year) ?? [];
    list.push({
      managerId: t.managerId,
      managerName: t.manager.displayName,
      teamName: t.teamName,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: t.pointsFor,
      pointsAgainst: t.pointsAgainst,
      regularSeasonRank: t.regularSeasonRank,
    });
    byYear.set(t.season.year, list);
  }

  return [...byYear.entries()]
    .map(([year, list]) => findLastPlace(year, list))
    .filter((x): x is LastPlaceFinish => x != null)
    .sort((a, b) => b.year - a.year);
}

/** Recorded punishments, newest first. Photographs are only ever admin-attached. */
async function listPunishmentPhotos(): Promise<
  (Omit<PunishmentPhoto, "photoUrl"> & { photoUrl: string | null })[]
> {
  const rows = await prisma.punishment.findMany({
    include: { manager: { select: { id: true, displayName: true } } },
    orderBy: { year: "desc" },
  });
  return rows.map((p) => ({
    id: p.id,
    year: p.year,
    managerId: p.manager?.id ?? null,
    managerName: p.manager?.displayName ?? null,
    description: p.description?.trim() || null,
    photoUrl: p.photoUrl,
  }));
}
