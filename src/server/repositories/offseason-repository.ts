import { prisma } from "@/lib/db";
import type { OffseasonData, OffseasonSpotlight } from "@/components/home/offseason-panel";

/**
 * The facts the homepage shows between seasons: who holds the belt, the draft
 * order if one has been set, and a few managers worth a sentence.
 *
 * Every sentence is assembled from recorded results — nothing is generated, so
 * nothing here can invent a storyline.
 */
export async function getOffseasonData(seasonId: string, year: number): Promise<OffseasonData> {
  const [championship, draft, lastSeason] = await Promise.all([
    prisma.championship.findFirst({
      where: { season: { year: { lt: year } } },
      orderBy: { season: { year: "desc" } },
      select: {
        championManagerId: true,
        championManager: { select: { displayName: true } },
        championFantasyTeam: { select: { teamName: true } },
        season: { select: { year: true } },
      },
    }),
    prisma.draft.findFirst({
      where: { seasonId },
      select: {
        picks: {
          where: { round: 1 },
          orderBy: { pickNumber: "asc" },
          select: { pickNumber: true, manager: { select: { displayName: true } } },
        },
      },
    }),
    prisma.season.findFirst({
      where: { year: { lt: year }, status: "COMPLETE" },
      orderBy: { year: "desc" },
      select: {
        year: true,
        fantasyTeams: {
          select: {
            teamName: true,
            wins: true,
            losses: true,
            ties: true,
            pointsFor: true,
            finalRank: true,
            regularSeasonRank: true,
            manager: { select: { id: true, displayName: true, photoUrl: true, avatarUrl: true } },
          },
        },
      },
    }),
  ]);

  const draftOrder = (draft?.picks ?? [])
    .filter((p) => p.manager)
    .map((p, i) => ({ slot: i + 1, managerName: p.manager!.displayName }));

  /*
   * Three spotlights, each chosen because a recorded number makes them
   * interesting: the highest scorer who did not win it, the biggest gap between
   * regular-season finish and final placing, and the team that scored least.
   */
  const spotlights: OffseasonSpotlight[] = [];
  const teams = lastSeason?.fantasyTeams.filter((t) => t.wins + t.losses + t.ties > 0) ?? [];
  if (teams.length > 0 && lastSeason) {
    const byPoints = [...teams].sort((a, b) => b.pointsFor - a.pointsFor);
    const topScorer = byPoints.find((t) => t.finalRank !== 1) ?? byPoints[0];
    const lowScorer = byPoints[byPoints.length - 1];
    const biggestMover = [...teams]
      .filter((t) => t.finalRank != null && t.regularSeasonRank != null)
      .sort(
        (a, b) =>
          (a.regularSeasonRank! - a.finalRank!) * -1 - (b.regularSeasonRank! - b.finalRank!) * -1,
      )
      .reverse()[0];

    const push = (
      team: (typeof teams)[number] | undefined,
      line: string,
    ) => {
      if (!team?.manager) return;
      if (spotlights.some((s) => s.managerId === team.manager.id)) return;
      spotlights.push({
        managerId: team.manager.id,
        managerName: team.manager.displayName,
        teamName: team.teamName,
        photoUrl: team.manager.photoUrl ?? team.manager.avatarUrl ?? null,
        line,
      });
    };

    if (topScorer) {
      push(
        topScorer,
        `Led ${lastSeason.year} with ${topScorer.pointsFor.toFixed(0)} points and finished ${topScorer.finalRank ? `#${topScorer.finalRank}` : `${topScorer.wins}-${topScorer.losses}`}.`,
      );
    }
    if (biggestMover?.regularSeasonRank != null && biggestMover.finalRank != null) {
      const swing = biggestMover.regularSeasonRank - biggestMover.finalRank;
      if (swing !== 0) {
        push(
          biggestMover,
          swing > 0
            ? `Went into the ${lastSeason.year} postseason #${biggestMover.regularSeasonRank} and came out #${biggestMover.finalRank}.`
            : `Was #${biggestMover.regularSeasonRank} after the ${lastSeason.year} regular season and finished #${biggestMover.finalRank}.`,
        );
      }
    }
    if (lowScorer) {
      push(
        lowScorer,
        `Scored least in ${lastSeason.year} — ${lowScorer.pointsFor.toFixed(0)} points across ${lowScorer.wins + lowScorer.losses + lowScorer.ties} games.`,
      );
    }
  }

  return {
    defendingChampionName: championship?.championManager.displayName ?? null,
    defendingChampionId: championship?.championManagerId ?? null,
    defendingChampionTeam: championship?.championFantasyTeam.teamName ?? null,
    defendingChampionYear: championship?.season.year ?? null,
    draftOrder,
    spotlights: spotlights.slice(0, 4),
  };
}
