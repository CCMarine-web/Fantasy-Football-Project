import { prisma } from "@/lib/db";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { generateSeasonSummary, type SeasonSummaryInput } from "@/server/ai/services/season-summary";

export interface SeasonNarrative {
  seasonYear: number;
  championName: string;
  championTeam: string;
  text: string;
  isMock: boolean;
}

/** Builds the structured, factual input for the last completed season's summary. */
async function buildSeasonSummaryInput(seasonId: string, year: number): Promise<SeasonSummaryInput | null> {
  const [championship, teams, topGame] = await Promise.all([
    prisma.championship.findUnique({
      where: { seasonId },
      include: {
        championManager: { select: { displayName: true } },
        championFantasyTeam: { select: { teamName: true, wins: true, losses: true, regularSeasonRank: true } },
        runnerUpFantasyTeam: { select: { manager: { select: { displayName: true } } } },
      },
    }),
    prisma.fantasyTeam.findMany({
      where: { seasonId },
      include: { manager: { select: { displayName: true } } },
      orderBy: { regularSeasonRank: "asc" },
    }),
    prisma.matchupTeam.findFirst({
      where: { matchup: { seasonId }, score: { not: null } },
      orderBy: { score: "desc" },
      include: { fantasyTeam: { include: { manager: { select: { displayName: true } } } }, matchup: { select: { week: true } } },
    }),
  ]);

  if (!championship || teams.length === 0) return null;

  const champTeam = championship.championFantasyTeam;
  const regularSeasonLeader = teams.find((t) => t.regularSeasonRank === 1) ?? teams[0];
  const mostPoints = [...teams].sort((a, b) => b.pointsFor - a.pointsFor)[0];
  const missedPlayoffTopScorer = [...teams]
    .filter((t) => !t.madePlayoffs)
    .sort((a, b) => b.pointsFor - a.pointsFor)[0];

  const storylines: string[] = [];
  storylines.push(
    `${championship.championManager.displayName} (${champTeam.teamName}) won the title` +
      (champTeam.regularSeasonRank && champTeam.regularSeasonRank > 2
        ? ` as the #${champTeam.regularSeasonRank} seed — a lower-seeded surprise run`
        : `, finishing ${champTeam.wins}-${champTeam.losses} in the regular season`) +
      ".",
  );
  if (regularSeasonLeader && !regularSeasonLeader.isChampion) {
    storylines.push(
      `Regular-season #1 ${regularSeasonLeader.manager.displayName} (${regularSeasonLeader.wins}-${regularSeasonLeader.losses}) fell short of the title — a playoff disappointment.`,
    );
  }
  if (mostPoints) {
    storylines.push(
      `${mostPoints.manager.displayName} led the league with ${mostPoints.pointsFor.toFixed(0)} points scored.`,
    );
  }
  if (missedPlayoffTopScorer && missedPlayoffTopScorer.id !== mostPoints?.id) {
    storylines.push(
      `${missedPlayoffTopScorer.manager.displayName} scored ${missedPlayoffTopScorer.pointsFor.toFixed(0)} points but missed the playoffs — the season's unluckiest team.`,
    );
  }
  if (topGame?.score != null) {
    storylines.push(
      `The season's biggest single-game explosion: ${topGame.fantasyTeam.manager.displayName} dropped ${topGame.score.toFixed(1)} in Week ${topGame.matchup.week}.`,
    );
  }

  const standingsSummary =
    `${regularSeasonLeader.manager.displayName} topped the regular season at ${regularSeasonLeader.wins}-${regularSeasonLeader.losses}. ` +
    `${championship.championManager.displayName} won it all` +
    (championship.runnerUpFantasyTeam
      ? `, beating ${championship.runnerUpFantasyTeam.manager.displayName} in the final.`
      : ".");

  return {
    seasonYear: year,
    champion: { teamName: champTeam.teamName, managerName: championship.championManager.displayName },
    standingsSummary,
    storylines,
  };
}

/**
 * Returns a narrative recap of the most recent completed season. Generate-once-
 * reuse: if a SEASON_SUMMARY generation already exists for that year, its text
 * is returned; otherwise it's generated once, logged, and reused. This keeps
 * the home page from calling the AI provider on every request (which would be
 * slow and costly with a real key). Returns null if there's no completed season.
 */
export async function getLastSeasonNarrative(): Promise<SeasonNarrative | null> {
  const season = await prisma.season.findFirst({
    where: { status: "COMPLETE" },
    orderBy: { year: "desc" },
  });
  if (!season) return null;

  const champ = await prisma.championship.findUnique({
    where: { seasonId: season.id },
    include: {
      championManager: { select: { displayName: true } },
      championFantasyTeam: { select: { teamName: true } },
    },
  });
  if (!champ) return null;

  const base = {
    seasonYear: season.year,
    championName: champ.championManager.displayName,
    championTeam: champ.championFantasyTeam.teamName,
  };

  // Reuse a previously generated summary for this year if one exists.
  const existing = await prisma.aIContentGeneration.findFirst({
    where: { contentType: "SEASON_SUMMARY", inputSummary: { path: ["seasonYear"], equals: season.year } },
    orderBy: { generatedAt: "desc" },
  });
  if (existing) {
    return { ...base, text: existing.outputText, isMock: existing.providerName === "mock" };
  }

  const input = await buildSeasonSummaryInput(season.id, season.year);
  if (!input) return null;
  const safeguards = await getContentSafeguards();
  const result = await generateSeasonSummary(input, safeguards);
  const gen = await prisma.aIContentGeneration.findUnique({ where: { id: result.generationId } });
  return { ...base, text: result.text, isMock: gen?.providerName === "mock" };
}
