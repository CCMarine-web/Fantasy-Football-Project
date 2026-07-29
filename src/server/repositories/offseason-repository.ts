import { prisma } from "@/lib/db";
import type { OffseasonData, OffseasonSpotlight } from "@/components/home/offseason-panel";
import { findLastPlace } from "@/server/stats/last-place";

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
            madePlayoffs: true,
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
   * interesting: the highest scorer who did not win it, the biggest swing
   * through the PLAYOFFS, and whoever finished bottom of the regular season.
   *
   * The swing is restricted to teams that actually made the playoffs. It used
   * to run over everybody, and `finalRank` for a team that missed the playoffs
   * is a consolation-bracket placing — so the homepage was telling readers that
   * Blake Mire "was #7 after the regular season and finished #10" on the
   * strength of two games in a bracket the site does not count. And the bottom
   * spotlight is now last place as the league defines it, not merely the lowest
   * points total.
   */
  const spotlights: OffseasonSpotlight[] = [];
  const teams = lastSeason?.fantasyTeams.filter((t) => t.wins + t.losses + t.ties > 0) ?? [];
  if (teams.length > 0 && lastSeason) {
    const byPoints = [...teams].sort((a, b) => b.pointsFor - a.pointsFor);
    const topScorer = byPoints.find((t) => t.finalRank !== 1) ?? byPoints[0];
    const lowScorer = byPoints[byPoints.length - 1];
    const biggestMover = [...teams]
      .filter((t) => t.madePlayoffs && t.finalRank != null && t.regularSeasonRank != null)
      .sort(
        (a, b) =>
          Math.abs(b.regularSeasonRank! - b.finalRank!) -
          Math.abs(a.regularSeasonRank! - a.finalRank!),
      )[0];

    const lastPlace = findLastPlace(
      lastSeason.year,
      teams.map((t) => ({
        managerId: t.manager.id,
        managerName: t.manager.displayName,
        teamName: t.teamName,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        pointsFor: t.pointsFor,
        pointsAgainst: 0,
        regularSeasonRank: t.regularSeasonRank,
      })),
    );

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
      // A finish is only quoted when the team played the bracket that produced
      // it; otherwise the record says the same thing without borrowing a number
      // from a game that decided nothing.
      const finish =
        topScorer.madePlayoffs && topScorer.finalRank
          ? `finished #${topScorer.finalRank}`
          : `went ${topScorer.wins}-${topScorer.losses} and missed the playoffs`;
      push(
        topScorer,
        `Led ${lastSeason.year} with ${topScorer.pointsFor.toFixed(0)} points and ${finish}.`,
      );
    }
    if (biggestMover?.regularSeasonRank != null && biggestMover.finalRank != null) {
      const swing = biggestMover.regularSeasonRank - biggestMover.finalRank;
      if (swing !== 0) {
        push(
          biggestMover,
          swing > 0
            ? `Entered the ${lastSeason.year} playoffs as the #${biggestMover.regularSeasonRank} seed and came out #${biggestMover.finalRank}.`
            : `Was the #${biggestMover.regularSeasonRank} seed in ${lastSeason.year} and finished #${biggestMover.finalRank}.`,
        );
      }
    }
    if (lastPlace) {
      const bottom = teams.find((t) => t.manager.id === lastPlace.managerId);
      push(
        bottom,
        `Finished bottom of the ${lastSeason.year} regular season at ${lastPlace.record}.`,
      );
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
