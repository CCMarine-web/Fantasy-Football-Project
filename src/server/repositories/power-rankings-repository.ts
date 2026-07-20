import { prisma } from "@/lib/db";
import { computePowerRankings, type PowerRankingTeamInput, type PowerRankingFactors } from "@/server/stats";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { generatePowerRankingBlurb } from "@/server/ai/services/power-ranking-blurb";

export interface PowerRankingRow {
  rank: number;
  previousRank: number | null;
  movement: number | null; // positive = moved up
  score: number;
  managerId: string;
  managerName: string;
  teamName: string;
  avatarUrl: string | null;
  record: string;
  factors: PowerRankingFactors;
  raw: {
    allPlayRecord: string;
    seasonPointsFor: number;
    averagePoints: number;
    stdDev: number;
    recentWeightedAvg: number;
  };
  blurb: string;
}

export interface PowerRankingsView {
  seasonYear: number;
  asOfWeek: number;
  isFinal: boolean; // true when showing a completed season's final rankings (offseason)
  rows: PowerRankingRow[];
}

const FACTOR_LABELS: Record<keyof PowerRankingFactors, string> = {
  allPlayWinPct: "all-play dominance",
  recentForm: "recent form",
  seasonPoints: "raw scoring",
  strengthOfWins: "quality wins",
  consistency: "week-to-week consistency",
};

function topAndBottomFactor(f: PowerRankingFactors): { top: string; weak: string } {
  const entries = Object.entries(f) as [keyof PowerRankingFactors, number][];
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  return { top: FACTOR_LABELS[sorted[0][0]], weak: FACTOR_LABELS[sorted[sorted.length - 1][0]] };
}

/**
 * Picks the season to rank: the current season if it has completed regular-
 * season games, otherwise the most recent season that does (i.e. last season,
 * in the offseason). Returns null if no season has any scored games yet.
 */
async function pickRankingSeason() {
  const seasons = await prisma.season.findMany({ orderBy: { year: "desc" } });
  for (const season of seasons) {
    const scored = await prisma.matchupTeam.count({
      where: { matchup: { seasonId: season.id, isPlayoff: false }, score: { not: null } },
    });
    if (scored > 0) return season;
  }
  return null;
}

export async function getPowerRankings(): Promise<PowerRankingsView | null> {
  const season = await pickRankingSeason();
  if (!season) return null;

  const matchupTeams = await prisma.matchupTeam.findMany({
    where: { matchup: { seasonId: season.id, isPlayoff: false }, score: { not: null } },
    include: {
      fantasyTeam: { include: { manager: true } },
      matchup: { select: { week: true, teams: { include: { fantasyTeam: true } } } },
    },
  });
  if (matchupTeams.length === 0) return null;

  // Build per-team game logs and metadata.
  const inputs = new Map<string, PowerRankingTeamInput>();
  const meta = new Map<
    string,
    { managerId: string; managerName: string; teamName: string; avatarUrl: string | null; wins: number; losses: number; ties: number }
  >();

  for (const mt of matchupTeams) {
    const teamId = mt.fantasyTeamId;
    const opponent = mt.matchup.teams.find((t) => t.fantasyTeamId !== teamId);
    if (!opponent || mt.score == null) continue;
    const result: "W" | "L" | "T" = mt.isWinner === true ? "W" : mt.isWinner === false ? "L" : "T";

    if (!inputs.has(teamId)) inputs.set(teamId, { teamId, games: [] });
    inputs.get(teamId)!.games.push({
      week: mt.matchup.week,
      points: mt.score,
      opponentId: opponent.fantasyTeamId,
      result,
    });

    if (!meta.has(teamId)) {
      meta.set(teamId, {
        managerId: mt.fantasyTeam.managerId,
        managerName: mt.fantasyTeam.manager.displayName,
        teamName: mt.fantasyTeam.teamName,
        avatarUrl: mt.fantasyTeam.manager.photoUrl ?? mt.fantasyTeam.manager.avatarUrl,
        wins: 0,
        losses: 0,
        ties: 0,
      });
    }
    const m = meta.get(teamId)!;
    if (result === "W") m.wins += 1;
    else if (result === "L") m.losses += 1;
    else m.ties += 1;
  }

  const teamInputs = [...inputs.values()];
  const maxWeek = Math.max(...matchupTeams.map((mt) => mt.matchup.week));
  const isFinal = season.status === "COMPLETE" || !season.isCurrent;

  const current = computePowerRankings(teamInputs, maxWeek);
  const prior = maxWeek > 1 ? computePowerRankings(teamInputs, maxWeek - 1) : [];
  const priorRankById = new Map(prior.map((p) => [p.teamId, p.rank]));

  const safeguards = await getContentSafeguards();

  const rows: PowerRankingRow[] = await Promise.all(
    current.map(async (r) => {
      const m = meta.get(r.teamId)!;
      const previousRank = priorRankById.get(r.teamId) ?? null;
      const movement = previousRank == null ? null : previousRank - r.rank;
      const record = `${m.wins}-${m.losses}${m.ties ? `-${m.ties}` : ""}`;
      const { top, weak } = topAndBottomFactor(r.factors);

      const blurb = await generatePowerRankingBlurb(
        {
          rank: r.rank,
          previousRank,
          teamName: m.teamName,
          managerName: m.managerName,
          record,
          powerScore: r.score,
          topFactor: top,
          weakestFactor: weak,
        },
        safeguards,
      );

      return {
        rank: r.rank,
        previousRank,
        movement,
        score: r.score,
        managerId: m.managerId,
        managerName: m.managerName,
        teamName: m.teamName,
        avatarUrl: m.avatarUrl,
        record,
        factors: r.factors,
        raw: {
          allPlayRecord: `${r.raw.allPlayWins}-${r.raw.allPlayLosses}${r.raw.allPlayTies ? `-${r.raw.allPlayTies}` : ""}`,
          seasonPointsFor: r.raw.seasonPointsFor,
          averagePoints: r.raw.averagePoints,
          stdDev: r.raw.stdDev,
          recentWeightedAvg: r.raw.recentWeightedAvg,
        },
        blurb,
      };
    }),
  );

  return { seasonYear: season.year, asOfWeek: maxWeek, isFinal, rows };
}
