/**
 * The best LEGAL lineup a roster could have started in a given week.
 *
 * "Optimal" used to mean the top N scorers regardless of position, which
 * could start two quarterbacks or three tight ends. It overstated the best
 * possible score by about 10 points a week, made every team's lineup
 * efficiency look worse than it was, and swapped two pairs in the 2026 power
 * rankings. The slots now come from the week's own starters (Sleeper's
 * roster_positions order — QB, RB, RB, WR, WR, TE, FLEX, FLEX, K, DEF for this
 * league), and each is filled only by an eligible position.
 *
 * Fill order: the single-position slots first, each with the best eligible
 * player left, then the flexible slots from whoever remains. With nested
 * eligibility (every FLEX-eligible position also has its own slot) this
 * greedy order is optimal.
 */

const ELIGIBLE: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  DST: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  // ESPN slot names (scripts/import/espn/reference.ts).
  "RB/WR": ["RB", "WR"],
  "WR/TE": ["WR", "TE"],
  OP: ["QB", "RB", "WR", "TE"],
};

/** Normalises a player's position for slot matching ("D/ST", "DST" → "DEF"). */
function normPosition(position: string): string {
  const p = position.toUpperCase();
  return p === "DST" || p === "D/ST" || p === "DEF" ? "DEF" : p;
}

export interface LineupPlayer {
  position: string;
  points: number;
}

/**
 * Highest total a legal lineup could have scored. `slots` are the week's
 * starting slots (bench/IR excluded). An unrecognised slot name is treated as
 * its own position, so a roster whose stored slots are plain positions (older
 * syncs recorded "RB" for a flex starter) still gets a legal, if slightly
 * conservative, optimum.
 */
export function optimalLineupPoints(slots: string[], players: LineupPlayer[]): number {
  const pool = players
    .map((p) => ({ position: normPosition(p.position), points: p.points }))
    .sort((a, b) => b.points - a.points);
  const used = new Array(pool.length).fill(false);
  const eligible = (slot: string) => ELIGIBLE[slot.toUpperCase()] ?? [normPosition(slot)];
  // Most restrictive slots first.
  const ordered = [...slots].sort((a, b) => eligible(a).length - eligible(b).length);
  let total = 0;
  for (const slot of ordered) {
    const allowed = eligible(slot);
    const i = pool.findIndex((p, idx) => !used[idx] && allowed.includes(p.position));
    if (i >= 0) {
      used[i] = true;
      total += pool[i].points;
    }
  }
  return total;
}

export interface ScoredRosterPlayer {
  isStarter: boolean;
  points: number;
  /** Stored slot: the Sleeper roster slot ("FLEX", "RB"...) or "BN". */
  lineupSlot: string | null;
  position: string;
}

/**
 * What a week's lineup scored and what the best legal lineup would have. The
 * slots are the starters' own slots; a starter with no usable slot stands in
 * with its position. The optimum is never below what was actually started.
 */
export function lineupOutcome(players: ScoredRosterPlayer[]): { starterPoints: number; optimalPoints: number } {
  const starters = players.filter((p) => p.isStarter);
  const starterPoints = starters.reduce((sum, p) => sum + p.points, 0);
  const slots = starters.map((p) => (p.lineupSlot && p.lineupSlot !== "BN" ? p.lineupSlot : p.position));
  const optimalPoints = Math.max(starterPoints, optimalLineupPoints(slots, players));
  return { starterPoints, optimalPoints };
}
