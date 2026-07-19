import type { EloGame, EloRating } from "./types";

export interface EloOptions {
  startingRating?: number;
  kFactor?: number;
}

// Sorts games chronologically (season if present, then week) so ratings update in the order games happened.
function sortChronologically(games: EloGame[]): EloGame[] {
  return [...games].sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || a.week - b.week);
}

// Standard logistic Elo: expectedA = 1 / (1 + 10^((ratingB - ratingA) / 400)); winner scores 1, loser 0, tie 0.5 each,
// and each rating shifts by K * (actualScore - expectedScore) after every game, processed in chronological order.
export function computeEloRatings(games: EloGame[], options: EloOptions = {}): EloRating[] {
  const startingRating = options.startingRating ?? 1500;
  const kFactor = options.kFactor ?? 32;
  const ratings = new Map<string, number>();

  const getRating = (teamId: string): number => ratings.get(teamId) ?? startingRating;

  for (const game of sortChronologically(games)) {
    const ratingA = getRating(game.teamAId);
    const ratingB = getRating(game.teamBId);

    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    const expectedB = 1 - expectedA;

    let scoreA: number;
    let scoreB: number;
    if (game.teamAScore > game.teamBScore) {
      scoreA = 1;
      scoreB = 0;
    } else if (game.teamAScore < game.teamBScore) {
      scoreA = 0;
      scoreB = 1;
    } else {
      scoreA = 0.5;
      scoreB = 0.5;
    }

    ratings.set(game.teamAId, ratingA + kFactor * (scoreA - expectedA));
    ratings.set(game.teamBId, ratingB + kFactor * (scoreB - expectedB));
  }

  return Array.from(ratings.entries()).map(([teamId, rating]) => ({ teamId, rating }));
}
