import type { GameResult, SeasonSegment } from "./types";

// Sorts games chronologically (season, then week) so streak calculations read in play order.
function sortChronologically(games: GameResult[]): GameResult[] {
  return [...games].sort((a, b) => a.season - b.season || a.week - b.week);
}

// Restricts a game log to regular-season games, playoff games, or all games ("all" is the default segment).
export function filterBySegment(games: GameResult[], segment: SeasonSegment = "all"): GameResult[] {
  if (segment === "regularSeason") return games.filter((g) => !g.isPlayoff);
  if (segment === "playoffs") return games.filter((g) => g.isPlayoff);
  return games;
}

export interface WinLossRecord {
  wins: number;
  losses: number;
  ties: number;
}

// Tallies wins, losses, and ties across the given games.
export function record(games: GameResult[], segment: SeasonSegment = "all"): WinLossRecord {
  const scoped = filterBySegment(games, segment);
  const rec: WinLossRecord = { wins: 0, losses: 0, ties: 0 };
  for (const g of scoped) {
    if (g.result === "W") rec.wins += 1;
    else if (g.result === "L") rec.losses += 1;
    else rec.ties += 1;
  }
  return rec;
}

// Win percentage = (wins + 0.5 * ties) / total games played; 0 when no games have been played.
export function winningPercentage(games: GameResult[], segment: SeasonSegment = "all"): number {
  const { wins, losses, ties } = record(games, segment);
  const total = wins + losses + ties;
  if (total === 0) return 0;
  return (wins + 0.5 * ties) / total;
}

// Sum of points scored across the given games.
export function totalPointsFor(games: GameResult[], segment: SeasonSegment = "all"): number {
  return filterBySegment(games, segment).reduce((sum, g) => sum + g.pointsFor, 0);
}

// Sum of points allowed across the given games.
export function totalPointsAgainst(games: GameResult[], segment: SeasonSegment = "all"): number {
  return filterBySegment(games, segment).reduce((sum, g) => sum + g.pointsAgainst, 0);
}

// Longest run of consecutive wins in chronological order; a tie breaks the streak rather than extending it.
export function longestWinningStreak(games: GameResult[], segment: SeasonSegment = "all"): number {
  const scoped = sortChronologically(filterBySegment(games, segment));
  let longest = 0;
  let current = 0;
  for (const g of scoped) {
    if (g.result === "W") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

// Longest run of consecutive losses in chronological order; a tie breaks the streak rather than extending it.
export function longestLosingStreak(games: GameResult[], segment: SeasonSegment = "all"): number {
  const scoped = sortChronologically(filterBySegment(games, segment));
  let longest = 0;
  let current = 0;
  for (const g of scoped) {
    if (g.result === "L") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

// Highest single-week points-for total; null when there are no games.
export function highestWeeklyScore(games: GameResult[], segment: SeasonSegment = "all"): number | null {
  const scoped = filterBySegment(games, segment);
  if (scoped.length === 0) return null;
  return Math.max(...scoped.map((g) => g.pointsFor));
}

// Lowest single-week points-for total; null when there are no games.
export function lowestWeeklyScore(games: GameResult[], segment: SeasonSegment = "all"): number | null {
  const scoped = filterBySegment(games, segment);
  if (scoped.length === 0) return null;
  return Math.min(...scoped.map((g) => g.pointsFor));
}

// Largest margin of victory (pointsFor - pointsAgainst) among wins; null when there are no wins.
export function largestMarginOfVictory(games: GameResult[], segment: SeasonSegment = "all"): number | null {
  const wins = filterBySegment(games, segment).filter((g) => g.result === "W");
  if (wins.length === 0) return null;
  return Math.max(...wins.map((g) => g.pointsFor - g.pointsAgainst));
}

// The decided game (win or loss, ties excluded) with the smallest absolute point differential; null if none.
export function closestGame(games: GameResult[], segment: SeasonSegment = "all"): GameResult | null {
  const decided = filterBySegment(games, segment).filter((g) => g.result !== "T");
  if (decided.length === 0) return null;
  return decided.reduce((closest, g) =>
    Math.abs(g.pointsFor - g.pointsAgainst) < Math.abs(closest.pointsFor - closest.pointsAgainst) ? g : closest
  );
}

// Highest points-for total recorded in a game that was still a loss; null when there are no losses.
export function highestScoreInLoss(games: GameResult[], segment: SeasonSegment = "all"): number | null {
  const losses = filterBySegment(games, segment).filter((g) => g.result === "L");
  if (losses.length === 0) return null;
  return Math.max(...losses.map((g) => g.pointsFor));
}

// Lowest points-for total recorded in a game that was still a win; null when there are no wins.
export function lowestScoreInWin(games: GameResult[], segment: SeasonSegment = "all"): number | null {
  const wins = filterBySegment(games, segment).filter((g) => g.result === "W");
  if (wins.length === 0) return null;
  return Math.min(...wins.map((g) => g.pointsFor));
}

export interface CareerSummary {
  record: WinLossRecord;
  winningPercentage: number;
  totalPointsFor: number;
  totalPointsAgainst: number;
  longestWinningStreak: number;
  longestLosingStreak: number;
  highestWeeklyScore: number | null;
  lowestWeeklyScore: number | null;
  largestMarginOfVictory: number | null;
  closestGame: GameResult | null;
  highestScoreInLoss: number | null;
  lowestScoreInWin: number | null;
}

// Convenience bundle of every career stat above for a given segment, so callers need one call per split.
export function careerSummary(games: GameResult[], segment: SeasonSegment = "all"): CareerSummary {
  return {
    record: record(games, segment),
    winningPercentage: winningPercentage(games, segment),
    totalPointsFor: totalPointsFor(games, segment),
    totalPointsAgainst: totalPointsAgainst(games, segment),
    longestWinningStreak: longestWinningStreak(games, segment),
    longestLosingStreak: longestLosingStreak(games, segment),
    highestWeeklyScore: highestWeeklyScore(games, segment),
    lowestWeeklyScore: lowestWeeklyScore(games, segment),
    largestMarginOfVictory: largestMarginOfVictory(games, segment),
    closestGame: closestGame(games, segment),
    highestScoreInLoss: highestScoreInLoss(games, segment),
    lowestScoreInWin: lowestScoreInWin(games, segment),
  };
}
