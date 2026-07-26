import { prisma } from "@/lib/db";
import {
  computeSeasonPowerRankings,
  POWER_WEIGHTS,
  type PostseasonResult,
  type SeasonPowerRow,
  type SeasonTeamInput,
} from "@/server/stats/season-power-rankings";
import { getBlurbs, hashInputs } from "@/server/ai/blurb-cache";

/**
 * Final power rankings for the most recently COMPLETED season.
 *
 * Two deliberate properties:
 *  - The numbers are computed from settled results only (no projections), by
 *    the pure, unit-tested formula in server/stats/season-power-rankings.ts.
 *  - Commentary is READ from AIBlurbCache. This function never calls a model,
 *    so the page renders in one round of queries. Blurbs are written by
 *    scripts/ai/backfill-blurbs.ts; a missing one simply renders nothing.
 */

export interface PowerRankingRow extends SeasonPowerRow {
  avatarUrl: string | null;
  record: string;
  /** Persisted AI commentary, or null when none has been generated. */
  blurb: string | null;
}

export interface PowerRankingsView {
  seasonYear: number;
  /** How many regular-season weeks fed the ranking. */
  weeksCounted: number;
  /** Always true — this view only ever shows a finished season. */
  isFinal: boolean;
  /** Set when the league has seasons but none are complete yet. */
  pendingSeasonYear: number | null;
  rows: PowerRankingRow[];
  methodology: { key: string; label: string; weight: number; description: string }[];
}

const METHODOLOGY: Record<keyof typeof POWER_WEIGHTS, { label: string; description: string }> = {
  postseason: {
    label: "Postseason",
    description: "How far the team actually went: champion, runner-up, third, made the playoffs, or missed.",
  },
  record: { label: "Record", description: "Regular-season win percentage, counting a tie as half a win." },
  scoring: { label: "Scoring", description: "Total points scored across the regular season." },
  strength: {
    label: "Strength",
    description: "All-play win% — each week's score compared against every other team, which removes schedule luck.",
  },
  consistency: {
    label: "Consistency",
    description: "Week-to-week standard deviation, inverted so steadier teams score higher.",
  },
};

function buildMethodology() {
  return (Object.keys(POWER_WEIGHTS) as (keyof typeof POWER_WEIGHTS)[]).map((key) => ({
    key,
    label: METHODOLOGY[key].label,
    weight: POWER_WEIGHTS[key],
    description: METHODOLOGY[key].description,
  }));
}

/** Maps settled season data onto the discrete postseason ladder. */
function postseasonResultFor(team: {
  isChampion: boolean;
  finalRank: number | null;
  madePlayoffs: boolean;
}): PostseasonResult {
  if (team.isChampion || team.finalRank === 1) return "CHAMPION";
  if (team.finalRank === 2) return "RUNNER_UP";
  if (team.finalRank === 3) return "THIRD";
  if (team.madePlayoffs) return "MADE_PLAYOFFS";
  return "MISSED_PLAYOFFS";
}

export async function getPowerRankings(): Promise<PowerRankingsView | null> {
  const season = await prisma.season.findFirst({
    where: { status: "COMPLETE" },
    orderBy: { year: "desc" },
    select: { id: true, year: true },
  });

  if (!season) {
    // No finished season yet — say so honestly rather than ranking a
    // half-played one as if it were final.
    const anySeason = await prisma.season.findFirst({ orderBy: { year: "desc" }, select: { year: true } });
    return {
      seasonYear: 0,
      weeksCounted: 0,
      isFinal: true,
      pendingSeasonYear: anySeason?.year ?? null,
      rows: [],
      methodology: buildMethodology(),
    };
  }

  const [teams, matchupTeams] = await Promise.all([
    prisma.fantasyTeam.findMany({
      where: { seasonId: season.id },
      select: {
        id: true,
        teamName: true,
        wins: true,
        losses: true,
        ties: true,
        finalRank: true,
        madePlayoffs: true,
        isChampion: true,
        manager: { select: { id: true, displayName: true, photoUrl: true, avatarUrl: true } },
      },
    }),
    // Regular season only: playoff teams play more games, so including the
    // postseason would inflate their cumulative scoring.
    prisma.matchupTeam.findMany({
      where: { matchup: { seasonId: season.id, isPlayoff: false }, score: { not: null } },
      select: { score: true, fantasyTeamId: true, matchup: { select: { week: true } } },
    }),
  ]);

  const scoresByTeam = new Map<string, { week: number; score: number }[]>();
  for (const mt of matchupTeams) {
    const list = scoresByTeam.get(mt.fantasyTeamId) ?? [];
    list.push({ week: mt.matchup.week, score: mt.score! });
    scoresByTeam.set(mt.fantasyTeamId, list);
  }

  const inputs: SeasonTeamInput[] = teams.map((t) => ({
    fantasyTeamId: t.id,
    managerId: t.manager?.id ?? null,
    managerName: t.manager?.displayName ?? "Unknown",
    teamName: t.teamName,
    weeklyScores: scoresByTeam.get(t.id) ?? [],
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    postseason: postseasonResultFor(t),
  }));

  const ranked = computeSeasonPowerRankings(inputs);

  // One query for all commentary.
  const subjects = ranked.map((r) => ({
    subjectKey: `${season.year}:${r.fantasyTeamId}`,
    inputHash: hashInputs({ rank: r.rank, score: r.score, w: r.wins, l: r.losses, pf: r.pointsFor, post: r.postseason }),
  }));
  const blurbs = await getBlurbs("POWER_RANKING", subjects);

  const avatarByTeam = new Map(teams.map((t) => [t.id, t.manager?.photoUrl ?? t.manager?.avatarUrl ?? null]));
  const weeksCounted = new Set(matchupTeams.map((mt) => mt.matchup.week)).size;

  return {
    seasonYear: season.year,
    weeksCounted,
    isFinal: true,
    pendingSeasonYear: null,
    methodology: buildMethodology(),
    rows: ranked.map((r) => ({
      ...r,
      avatarUrl: avatarByTeam.get(r.fantasyTeamId) ?? null,
      record: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`,
      blurb: blurbs.get(`${season.year}:${r.fantasyTeamId}`)?.text ?? null,
    })),
  };
}
