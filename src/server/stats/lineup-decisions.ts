/**
 * The best lineup a manager could have set, and the decisions that cost them.
 *
 * Uses the same legal-lineup rules as the power rankings' lineup efficiency
 * (FLEX takes RB/WR/TE; K and DEF only themselves), filling the most
 * restrictive slots first with the highest scorer still available.
 */

const ELIGIBLE: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

const norm = (p: string) => {
  const u = p.toUpperCase();
  return u === "DST" || u === "D/ST" ? "DEF" : u;
};

export interface DecisionPlayer {
  id: string;
  name: string;
  position: string;
  points: number;
  isStarter: boolean;
  /** Stored slot ("QB", "FLEX", …) or "BN". */
  slot: string;
}

export interface LineupDecisions {
  actual: number;
  best: number;
  /** best - actual, never negative. */
  leftOnBench: number;
  /** "Started Waddle (3.2) over Charbonnet (9.6)": each costly start. */
  mistakes: { started: DecisionPlayer; benched: DecisionPlayer; cost: number }[];
  bestIds: Set<string>;
}

export function lineupDecisions(players: DecisionPlayer[]): LineupDecisions {
  const starters = players.filter((p) => p.isStarter);
  const slots = starters.map((p) => (p.slot && p.slot !== "BN" ? p.slot : p.position));
  const eligible = (slot: string) => ELIGIBLE[slot.toUpperCase()] ?? [norm(slot)];
  const pool = [...players].sort((a, b) => b.points - a.points);
  const used = new Set<string>();
  const ordered = [...slots].sort((a, b) => eligible(a).length - eligible(b).length);
  for (const slot of ordered) {
    const p = pool.find((x) => !used.has(x.id) && eligible(slot).includes(norm(x.position)));
    if (p) used.add(p.id);
  }
  const actual = starters.reduce((s, p) => s + p.points, 0);
  const best = Math.max(actual, pool.filter((p) => used.has(p.id)).reduce((s, p) => s + p.points, 0));

  // Pair each starter who shouldn't have started with the bench player who
  // should have, preferring the same position (then any FLEX-eligible swap).
  const wrongStarters = starters.filter((p) => !used.has(p.id)).sort((a, b) => a.points - b.points);
  const missedBench = players.filter((p) => !p.isStarter && used.has(p.id)).sort((a, b) => b.points - a.points);
  const mistakes: LineupDecisions["mistakes"] = [];
  const taken = new Set<string>();
  for (const s of wrongStarters) {
    const allowed = eligible(s.slot && s.slot !== "BN" ? s.slot : s.position);
    const b =
      missedBench.find((x) => !taken.has(x.id) && norm(x.position) === norm(s.position)) ??
      missedBench.find((x) => !taken.has(x.id) && allowed.includes(norm(x.position))) ??
      missedBench.find((x) => !taken.has(x.id));
    if (!b) continue;
    taken.add(b.id);
    if (b.points > s.points) mistakes.push({ started: s, benched: b, cost: Math.round((b.points - s.points) * 10) / 10 });
  }
  return { actual, best, leftOnBench: Math.round((best - actual) * 10) / 10, mistakes, bestIds: used };
}
