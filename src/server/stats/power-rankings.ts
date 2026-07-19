// Composite power-ranking engine. Pure/deterministic — no I/O. Combines five
// league-normalized factors into a 0-100 power score per team:
//
//   score = 0.30 * allPlayWinPct   (luck-independent quality: your record if
//                                    you had played every team every week)
//         + 0.25 * recentForm      (last 4 weeks, most-recent weighted heaviest)
//         + 0.20 * seasonPoints     (total points-for)
//         + 0.15 * strengthOfWins   (avg all-play quality of the teams you beat)
//         + 0.10 * consistency      (inverse of weekly scoring std-dev)
//
// Each factor is min-max normalized to 0-100 across the league for the given
// week window, so the composite compares teams against each other, not against
// an absolute scale. Weights are exported (POWER_WEIGHTS) so they're easy to tune.

export interface PowerRankingGame {
  week: number;
  points: number;
  opponentId: string;
  result: "W" | "L" | "T";
}

export interface PowerRankingTeamInput {
  teamId: string;
  games: PowerRankingGame[];
}

export interface PowerRankingFactors {
  allPlayWinPct: number; // 0-100 (normalized)
  recentForm: number; // 0-100
  seasonPoints: number; // 0-100
  strengthOfWins: number; // 0-100
  consistency: number; // 0-100
}

export interface PowerRankingResult {
  teamId: string;
  rank: number;
  score: number; // composite, 0-100
  factors: PowerRankingFactors;
  raw: {
    allPlayWins: number;
    allPlayLosses: number;
    allPlayTies: number;
    seasonPointsFor: number;
    averagePoints: number;
    stdDev: number;
    recentWeightedAvg: number;
    strengthOfWinsRaw: number; // avg opponent all-play win% (0-1), among beaten opponents
  };
}

export const POWER_WEIGHTS = {
  allPlayWinPct: 0.3,
  recentForm: 0.25,
  seasonPoints: 0.2,
  strengthOfWins: 0.15,
  consistency: 0.1,
} as const;

/** Min-max normalize a value within [min,max] to 0-100; 50 if the range is flat. */
function normalize(value: number, min: number, max: number): number {
  if (max - min < 1e-9) return 50;
  return ((value - min) / (max - min)) * 100;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

// Weighted average of the last N games, most recent heaviest (weights N..1).
function recentWeightedAverage(games: PowerRankingGame[], window = 4): number {
  const recent = [...games].sort((a, b) => a.week - b.week).slice(-window);
  if (recent.length === 0) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  recent.forEach((g, i) => {
    const w = i + 1; // oldest of the window = 1, newest = recent.length
    weightedSum += g.points * w;
    weightTotal += w;
  });
  return weightedSum / weightTotal;
}

/**
 * Computes composite power rankings for a set of teams, considering only games
 * up to and including `asOfWeek`. Every team must share the same league so
 * all-play and strength-of-wins can be computed across the full field.
 */
export function computePowerRankings(
  teams: PowerRankingTeamInput[],
  asOfWeek: number,
): PowerRankingResult[] {
  // Clip each team's games to the week window.
  const clipped = teams.map((t) => ({
    teamId: t.teamId,
    games: t.games.filter((g) => g.week <= asOfWeek),
  }));

  // Build per-week score map for all-play: week -> [{teamId, points}].
  const byWeek = new Map<number, { teamId: string; points: number }[]>();
  for (const t of clipped) {
    for (const g of t.games) {
      const list = byWeek.get(g.week) ?? [];
      list.push({ teamId: t.teamId, points: g.points });
      byWeek.set(g.week, list);
    }
  }

  // All-play record per team (compare vs every other team each week).
  const allPlay = new Map<string, { w: number; l: number; t: number }>();
  for (const t of clipped) allPlay.set(t.teamId, { w: 0, l: 0, t: 0 });
  for (const scores of byWeek.values()) {
    for (const a of scores) {
      const rec = allPlay.get(a.teamId)!;
      for (const b of scores) {
        if (a.teamId === b.teamId) continue;
        if (a.points > b.points) rec.w += 1;
        else if (a.points < b.points) rec.l += 1;
        else rec.t += 1;
      }
    }
  }
  const allPlayPct = (id: string): number => {
    const r = allPlay.get(id)!;
    const total = r.w + r.l + r.t;
    return total === 0 ? 0 : (r.w + 0.5 * r.t) / total;
  };

  // Per-team raw metrics.
  const raw = clipped.map((t) => {
    const points = t.games.map((g) => g.points);
    const beaten = t.games.filter((g) => g.result === "W").map((g) => g.opponentId);
    const strengthOfWinsRaw = beaten.length ? mean(beaten.map((oppId) => allPlayPct(oppId))) : 0;
    const r = allPlay.get(t.teamId)!;
    return {
      teamId: t.teamId,
      seasonPointsFor: points.reduce((a, b) => a + b, 0),
      averagePoints: mean(points),
      stdDev: stdDev(points),
      recentWeightedAvg: recentWeightedAverage(t.games),
      allPlayWinPct: allPlayPct(t.teamId),
      allPlayWins: r.w,
      allPlayLosses: r.l,
      allPlayTies: r.t,
      strengthOfWinsRaw,
    };
  });

  // Normalization bounds across the league.
  const bounds = (sel: (x: (typeof raw)[number]) => number) => {
    const vals = raw.map(sel);
    return { min: Math.min(...vals), max: Math.max(...vals) };
  };
  const bAllPlay = bounds((x) => x.allPlayWinPct);
  const bRecent = bounds((x) => x.recentWeightedAvg);
  const bPoints = bounds((x) => x.seasonPointsFor);
  const bSoW = bounds((x) => x.strengthOfWinsRaw);
  const bStd = bounds((x) => x.stdDev);

  const results: PowerRankingResult[] = raw.map((x) => {
    const factors: PowerRankingFactors = {
      allPlayWinPct: normalize(x.allPlayWinPct, bAllPlay.min, bAllPlay.max),
      recentForm: normalize(x.recentWeightedAvg, bRecent.min, bRecent.max),
      seasonPoints: normalize(x.seasonPointsFor, bPoints.min, bPoints.max),
      strengthOfWins: normalize(x.strengthOfWinsRaw, bSoW.min, bSoW.max),
      // Lower std-dev is better, so invert: 100 - normalized(stdDev).
      consistency: 100 - normalize(x.stdDev, bStd.min, bStd.max),
    };
    const score =
      POWER_WEIGHTS.allPlayWinPct * factors.allPlayWinPct +
      POWER_WEIGHTS.recentForm * factors.recentForm +
      POWER_WEIGHTS.seasonPoints * factors.seasonPoints +
      POWER_WEIGHTS.strengthOfWins * factors.strengthOfWins +
      POWER_WEIGHTS.consistency * factors.consistency;
    return {
      teamId: x.teamId,
      rank: 0,
      score: Number(score.toFixed(1)),
      factors,
      raw: {
        allPlayWins: x.allPlayWins,
        allPlayLosses: x.allPlayLosses,
        allPlayTies: x.allPlayTies,
        seasonPointsFor: Number(x.seasonPointsFor.toFixed(1)),
        averagePoints: Number(x.averagePoints.toFixed(1)),
        stdDev: Number(x.stdDev.toFixed(1)),
        recentWeightedAvg: Number(x.recentWeightedAvg.toFixed(1)),
        strengthOfWinsRaw: Number(x.strengthOfWinsRaw.toFixed(3)),
      },
    };
  });

  results.sort((a, b) => b.score - a.score || b.raw.seasonPointsFor - a.raw.seasonPointsFor);
  results.forEach((r, i) => (r.rank = i + 1));
  return results;
}
