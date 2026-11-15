import { buildPositionContext, type PositionContext } from "./trade-value";

/**
 * POSITION-ADJUSTED VALUE — the Trade Tribunal's measure, shared.
 *
 * Raw points can't compare positions: a 20-point quarterback is replaceable off
 * the wire, a 20-point running back is not. The Tribunal already judges trades
 * by points per game ABOVE THE REPLACEMENT LEVEL at the player's position; the
 * draft board's steal/bust, the revisited draft grade and "Best pickups" use
 * the same line (the Nov 2026 audit found "Biggest steal: Bo Nix at pick 163"
 * and seven quarterbacks or kickers in the top eight pickups).
 *
 * Replacement level comes from `buildPositionContext`: the first player outside
 * the startable pool (teams × starting slots, plus a share of the flex) among
 * everyone who played 3+ games that season.
 */

export interface PlayerProduction {
  position: string;
  points: number;
  games: number;
}

/** Fewest games for a player to count toward a position's pool (as the Tribunal). */
export const MIN_POOL_GAMES = 3;

export type ReplacementLevels = Record<string, PositionContext>;

export function replacementLevels(players: PlayerProduction[], teamCount: number): ReplacementLevels {
  const byPosition = new Map<string, number[]>();
  for (const p of players) {
    if (p.games < MIN_POOL_GAMES) continue;
    const list = byPosition.get(p.position) ?? [];
    list.push(p.points / p.games);
    byPosition.set(p.position, list);
  }
  const out: ReplacementLevels = {};
  for (const [position, ppgs] of byPosition) out[position] = buildPositionContext(position, ppgs, teamCount);
  return out;
}

/** Points per game above replacement at the position (0 replacement when unknown). */
export function ppgAboveReplacement(ppg: number, position: string | null | undefined, levels: ReplacementLevels): number {
  return ppg - (position ? (levels[position]?.replacementPpg ?? 0) : 0);
}

const ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
const orderOf = (p: string) => (ORDER.includes(p) ? ORDER.indexOf(p) : ORDER.length);

/** "QB 17.3 · RB 9.1 · WR 9.8 · TE 7.2 · K 8.0 · DEF 6.9" (points per game). */
export function replacementSummary(levels: ReplacementLevels): string {
  return Object.keys(levels)
    .sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b))
    .map((p) => `${p} ${levels[p].replacementPpg.toFixed(1)}`)
    .join(" · ");
}

/** Just the per-game replacement line per position. */
export function replacementPpgs(levels: ReplacementLevels): Record<string, number> {
  return Object.fromEntries(Object.entries(levels).map(([p, c]) => [p, Math.round(c.replacementPpg * 10) / 10]));
}
