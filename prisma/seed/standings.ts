import type { ManagerKey, StandingsAccumulator } from "./types";

export function createAccumulators(
  managerKeys: ManagerKey[],
  fantasyTeamIdByManagerKey: Record<ManagerKey, string>,
): StandingsAccumulator[] {
  return managerKeys.map((managerKey, teamIndex) => ({
    fantasyTeamId: fantasyTeamIdByManagerKey[managerKey]!,
    managerKey,
    teamIndex,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    currentStreakType: null,
    currentStreakCount: 0,
  }));
}

export function applyResult(
  acc: StandingsAccumulator,
  pointsFor: number,
  pointsAgainst: number,
  result: "W" | "L" | "T",
): void {
  acc.pointsFor += pointsFor;
  acc.pointsAgainst += pointsAgainst;
  if (result === "W") acc.wins += 1;
  else if (result === "L") acc.losses += 1;
  else acc.ties += 1;

  if (acc.currentStreakType === result) {
    acc.currentStreakCount += 1;
  } else {
    acc.currentStreakType = result;
    acc.currentStreakCount = 1;
  }
}

export function streakLabel(acc: StandingsAccumulator): string {
  if (!acc.currentStreakType) return "-";
  return `${acc.currentStreakType}${acc.currentStreakCount}`;
}

/** Ranks accumulators 1..N by wins desc, then pointsFor desc (simple, deterministic tie-break). */
export function rankAccumulators(accs: StandingsAccumulator[]): StandingsAccumulator[] {
  return [...accs].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.teamIndex - b.teamIndex;
  });
}
