import type { GameResult } from "./types";

// Sorts games chronologically (season, then week) so streak/"current" calculations read in play order.
function sortChronologically(games: GameResult[]): GameResult[] {
  return [...games].sort((a, b) => a.season - b.season || a.week - b.week);
}

export interface HeadToHeadRecord {
  wins: number;
  losses: number;
  ties: number;
}

// Tallies the perspective manager's wins, losses, and ties against this one opponent.
export function headToHeadRecord(games: GameResult[]): HeadToHeadRecord {
  const rec: HeadToHeadRecord = { wins: 0, losses: 0, ties: 0 };
  for (const g of games) {
    if (g.result === "W") rec.wins += 1;
    else if (g.result === "L") rec.losses += 1;
    else rec.ties += 1;
  }
  return rec;
}

// Count of meetings between the two managers that occurred in the playoffs.
export function playoffMeetingCount(games: GameResult[]): number {
  return games.filter((g) => g.isPlayoff).length;
}

// The decided meeting (win or loss, ties excluded) with the smallest absolute point differential; null if none.
export function closestMeeting(games: GameResult[]): GameResult | null {
  const decided = games.filter((g) => g.result !== "T");
  if (decided.length === 0) return null;
  return decided.reduce((closest, g) =>
    Math.abs(g.pointsFor - g.pointsAgainst) < Math.abs(closest.pointsFor - closest.pointsAgainst) ? g : closest
  );
}

// The decided meeting (win or loss, ties excluded) with the largest absolute point differential; null if none.
export function largestBlowout(games: GameResult[]): GameResult | null {
  const decided = games.filter((g) => g.result !== "T");
  if (decided.length === 0) return null;
  return decided.reduce((biggest, g) =>
    Math.abs(g.pointsFor - g.pointsAgainst) > Math.abs(biggest.pointsFor - biggest.pointsAgainst) ? g : biggest
  );
}

export interface HeadToHeadStreak {
  winner: "self" | "opponent" | null; // "self" = the manager whose perspective this game log is from
  length: number;
}

// Current streak = consecutive identical results counting back from the most recent meeting; a tie resets it to none.
export function currentStreak(games: GameResult[]): HeadToHeadStreak {
  const chronological = sortChronologically(games);
  if (chronological.length === 0) return { winner: null, length: 0 };

  const lastResult = chronological[chronological.length - 1].result;
  if (lastResult === "T") return { winner: null, length: 0 };

  let length = 0;
  for (let i = chronological.length - 1; i >= 0; i -= 1) {
    if (chronological[i].result !== lastResult) break;
    length += 1;
  }
  return { winner: lastResult === "W" ? "self" : "opponent", length };
}
