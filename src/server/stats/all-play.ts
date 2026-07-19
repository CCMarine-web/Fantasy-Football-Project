import type { AllPlayRecord, AllPlayTotals, WeeklyScore } from "./types";

// All-play record for one week: compares every team's score against every other team's score that week
// (not just their actual opponent), counting a win/loss/tie for each pairing.
export function weeklyAllPlay(scores: WeeklyScore[], week: number, season: number): AllPlayRecord[] {
  return scores.map((team) => {
    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const other of scores) {
      if (other.teamId === team.teamId) continue;
      if (team.points > other.points) wins += 1;
      else if (team.points < other.points) losses += 1;
      else ties += 1;
    }
    return { teamId: team.teamId, week, season, wins, losses, ties };
  });
}

// Sums a set of weekly all-play records (e.g. a whole season) into one win/loss/tie/games total per team.
export function seasonAllPlayTotals(records: AllPlayRecord[]): AllPlayTotals[] {
  const byTeam = new Map<string, AllPlayTotals>();
  for (const rec of records) {
    const existing = byTeam.get(rec.teamId) ?? { teamId: rec.teamId, wins: 0, losses: 0, ties: 0, games: 0 };
    existing.wins += rec.wins;
    existing.losses += rec.losses;
    existing.ties += rec.ties;
    existing.games += rec.wins + rec.losses + rec.ties;
    byTeam.set(rec.teamId, existing);
  }
  return Array.from(byTeam.values());
}

// Expected wins = sum across weeks of that week's all-play win rate (wins + 0.5*ties) / games played that week.
export function expectedWins(records: AllPlayRecord[]): number {
  let total = 0;
  for (const rec of records) {
    const games = rec.wins + rec.losses + rec.ties;
    if (games === 0) continue;
    total += (rec.wins + 0.5 * rec.ties) / games;
  }
  return total;
}

// Schedule luck = a team's actual win total minus their all-play expected win total; positive means lucky.
export function scheduleLuck(actualWins: number, records: AllPlayRecord[]): number {
  return actualWins - expectedWins(records);
}
