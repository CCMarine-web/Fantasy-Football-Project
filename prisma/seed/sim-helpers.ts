import {
  BENCH_POINTS_BY_POSITION,
  DRAFT_ROUND_POSITIONS,
  ROUND_SLOT_MAP,
  STARTER_WEIGHT_BY_ROUND,
  TEAM_WEEKLY_MEAN,
  TEAM_WEEKLY_STDDEV,
} from "./constants";
import type { Rng } from "./rng";
import type { Position } from "./types";

export interface GameScoreResult {
  scoreA: number;
  scoreB: number;
  winner: "A" | "B" | "TIE";
}

/**
 * Simulates one matchup's two final scores from each side's strength offset.
 * When `forceWinner` is set (used only for the small number of
 * narratively-required playoff games — see season.ts), scores are re-drawn
 * from the same realistic distribution until the desired side wins, bounded
 * by maxRetries. Everything else in the league (every regular-season game,
 * every quarterfinal) calls this with no forcing at all.
 */
export function simulateGameScores(
  rng: Rng,
  strengthA: number,
  strengthB: number,
  opts?: { forceWinner?: "A" | "B"; maxRetries?: number },
): GameScoreResult {
  const maxRetries = opts?.maxRetries ?? 400;
  let attempt = 0;
  let scoreA: number;
  let scoreB: number;
  do {
    scoreA = rng.round(rng.gaussian(TEAM_WEEKLY_MEAN + strengthA, TEAM_WEEKLY_STDDEV));
    scoreB = rng.round(rng.gaussian(TEAM_WEEKLY_MEAN + strengthB, TEAM_WEEKLY_STDDEV));
    scoreA = Math.max(scoreA, 45);
    scoreB = Math.max(scoreB, 45);
    attempt++;
  } while (
    opts?.forceWinner &&
    attempt < maxRetries &&
    ((opts.forceWinner === "A" && scoreA <= scoreB) ||
      (opts.forceWinner === "B" && scoreB <= scoreA))
  );

  // Fallback safety net: if retries somehow didn't converge, nudge the
  // forced winner's score just above the other so the result is unambiguous.
  if (opts?.forceWinner === "A" && scoreA <= scoreB) scoreA = rng.round(scoreB + rng.float(1, 6));
  if (opts?.forceWinner === "B" && scoreB <= scoreA) scoreB = rng.round(scoreA + rng.float(1, 6));

  const winner: "A" | "B" | "TIE" = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "TIE";
  return { scoreA, scoreB, winner };
}

export interface StarterLine {
  round: number;
  position: Position;
  lineupSlot: string;
  points: number;
  projectedPoints: number;
}

export interface BenchLine {
  round: number;
  position: Position;
  points: number;
  projectedPoints: number;
}

export interface WeeklyLineup {
  starters: StarterLine[];
  bench: BenchLine[];
  benchPoints: number;
}

/**
 * Distributes a team's total weekly score across its 9 starter slots by
 * position-typical weight (with per-player noise), scaled so the starters'
 * points sum exactly to `totalScore`. Bench players are simulated
 * independently by position mean/stdDev, which is what makes "bench
 * outscored a starter" possible (and thus lineup-efficiency records
 * interesting) — bench totals are NOT constrained to relate to the team score.
 */
export function buildWeeklyLineup(rng: Rng, totalScore: number): WeeklyLineup {
  const starterRounds = Object.keys(STARTER_WEIGHT_BY_ROUND).map(Number);
  const rawWeights = starterRounds.map((round) => {
    const weight = STARTER_WEIGHT_BY_ROUND[round]!;
    return weight * rng.float(0.7, 1.3);
  });
  const rawSum = rawWeights.reduce((a, b) => a + b, 0);

  const starters: StarterLine[] = starterRounds.map((round, i) => {
    const share = (rawWeights[i]! / rawSum) * totalScore;
    const points = rng.round(share);
    const position = DRAFT_ROUND_POSITIONS[round - 1]!;
    const lineupSlot = ROUND_SLOT_MAP[round]!.lineupSlot;
    const projectedPoints = rng.round(Math.max(0, points + rng.gaussian(0, 3.5)));
    return { round, position, lineupSlot, points, projectedPoints };
  });

  // Fix rounding drift so starters sum exactly to totalScore.
  const currentSum = starters.reduce((a, s) => a + s.points, 0);
  const drift = rng.round(totalScore - currentSum);
  if (starters.length > 0) {
    starters[starters.length - 1]!.points = rng.round(starters[starters.length - 1]!.points + drift);
  }

  const benchRounds = Object.entries(ROUND_SLOT_MAP)
    .filter(([, slot]) => !slot.isStarter)
    .map(([round]) => Number(round));

  const bench: BenchLine[] = benchRounds.map((round) => {
    const position = DRAFT_ROUND_POSITIONS[round - 1]!;
    const { mean, stdDev } = BENCH_POINTS_BY_POSITION[position];
    const points = rng.round(Math.max(0, rng.gaussian(mean, stdDev)));
    const projectedPoints = rng.round(Math.max(0, points + rng.gaussian(0, 2.5)));
    return { round, position, points, projectedPoints };
  });

  const benchPoints = rng.round(bench.reduce((a, b) => a + b.points, 0));

  return { starters, bench, benchPoints };
}
