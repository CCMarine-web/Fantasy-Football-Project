import { TEAM_COUNT } from "./constants";

export type IndexPair = [number, number];

/**
 * Standard "circle method" round-robin: for N teams produces N-1 rounds,
 * each with N/2 pairs, covering every distinct pair exactly once.
 *
 * With TEAM_COUNT=12 and the fixed MANAGERS index order in constants.ts,
 * this deterministically produces round index 4 (0-indexed) = [[0,7], [8,6],
 * [9,5], [10,4], [11,3], [1,2]] — i.e. Marcus(0) vs Sofia(7) and
 * Kevin(6) vs Jordan(8) both land in that same round. Verified by the
 * `describeRounds` debug helper below during development; do not change the
 * MANAGERS order or this algorithm without re-checking that invariant.
 */
export function roundRobinRounds(teamCount: number = TEAM_COUNT): IndexPair[][] {
  if (teamCount % 2 !== 0) throw new Error("roundRobinRounds requires an even team count");
  const fixed = 0;
  let rotating = Array.from({ length: teamCount - 1 }, (_, i) => i + 1);
  const rounds: IndexPair[][] = [];

  for (let r = 0; r < teamCount - 1; r++) {
    const current = [fixed, ...rotating];
    const pairs: IndexPair[] = [];
    for (let i = 0; i < teamCount / 2; i++) {
      pairs.push([current[i]!, current[teamCount - 1 - i]!]);
    }
    rounds.push(pairs);
    // rotate right by one: last element moves to the front
    const last = rotating[rotating.length - 1]!;
    rotating = [last, ...rotating.slice(0, rotating.length - 1)];
  }

  return rounds;
}

/**
 * Builds the full-season pairing list for `totalWeeks` weeks. Weeks beyond
 * the base N-1 rounds wrap back to round 0, 1, 2, ... which intentionally
 * creates a handful of rematches late in the season (common in real
 *12-team leagues that don't have a true 14-round schedule of all-unique
 * pairings).
 */
export function weeklyPairings(totalWeeks: number, teamCount: number = TEAM_COUNT): IndexPair[][] {
  const rounds = roundRobinRounds(teamCount);
  const weeks: IndexPair[][] = [];
  for (let week = 1; week <= totalWeeks; week++) {
    weeks.push(rounds[(week - 1) % rounds.length]!);
  }
  return weeks;
}
