import { compareStandings, type RankableTeam } from "./standings";

/**
 * PLAYOFF ODDS — Monte Carlo over the remaining regular-season schedule.
 *
 * Each team's weekly score is drawn from a normal distribution with the team's
 * recency-weighted mean and standard deviation this season (weights fade 12% a
 * week, the same decay the power rankings use). Every simulated season is
 * ranked with the site's standings ranker (win %, then points for), so a sim
 * can win a spot on points exactly the way the real table would. The postseason
 * is then played out: seeds 1-2 get byes, 3v6 and 4v5, the top seed meets the
 * lowest survivor (re-seeded), winners meet in the final.
 *
 * Seeded and deterministic: the same inputs always give the same odds, so a
 * pre-rendered page doesn't wobble between renders.
 *
 * Clinched / eliminated are NOT read off the simulation (100% of 10,000 runs is
 * not proof). They are exact: clinched when fewer than `playoffTeams` other
 * teams can even reach this team's current win total; eliminated when at least
 * `playoffTeams` teams already have more wins than this team can reach.
 */

export interface OddsTeam extends RankableTeam {
  /** This season's regular-season scores, oldest first. */
  scores: number[];
}

export interface Game {
  a: string;
  b: string;
}

export interface TeamOdds {
  id: string;
  playoffPct: number;
  byePct: number;
  titlePct: number;
  lastPct: number;
  clinched: boolean;
  eliminated: boolean;
  mean: number;
  sd: number;
}

const DECAY = 0.88;

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number): number {
  // Box-Muller
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function recencyStats(scores: number[], leagueMean: number, leagueSd: number): { mean: number; sd: number } {
  if (scores.length === 0) return { mean: leagueMean, sd: leagueSd };
  const w = scores.map((_, i) => DECAY ** (scores.length - 1 - i));
  const tw = w.reduce((a, b) => a + b, 0);
  const mean = scores.reduce((s, x, i) => s + x * w[i], 0) / tw;
  const variance = scores.reduce((s, x, i) => s + w[i] * (x - mean) ** 2, 0) / tw;
  // Few games = noisy SD: shrink towards the league's.
  const k = Math.min(1, scores.length / 6);
  return { mean, sd: Math.sqrt(k * variance + (1 - k) * leagueSd ** 2) };
}

export function simulatePlayoffOdds(input: {
  teams: OddsTeam[];
  remaining: Game[];
  playoffTeams: number;
  byes?: number;
  sims?: number;
  seed?: number;
}): Map<string, TeamOdds> {
  const { teams, remaining, playoffTeams } = input;
  const byes = input.byes ?? 2;
  const sims = input.sims ?? 10_000;
  const rand = rng(input.seed ?? 20261114);
  const all = teams.flatMap((t) => t.scores);
  const leagueMean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 110;
  const leagueSd = all.length > 1 ? Math.sqrt(all.reduce((s, x) => s + (x - leagueMean) ** 2, 0) / all.length) : 20;
  const dist = new Map(teams.map((t) => [t.id, recencyStats(t.scores, leagueMean, leagueSd)]));
  const draw = (id: string) => {
    const d = dist.get(id)!;
    return d.mean + d.sd * normal(rand);
  };

  const tally = new Map(teams.map((t) => [t.id, { playoff: 0, bye: 0, title: 0, last: 0 }]));
  for (let s = 0; s < sims; s += 1) {
    const state = new Map(teams.map((t) => [t.id, { ...t, scores: [] as number[] }]));
    for (const g of remaining) {
      const a = state.get(g.a);
      const b = state.get(g.b);
      if (!a || !b) continue;
      const sa = draw(g.a);
      const sb = draw(g.b);
      a.pointsFor += sa;
      b.pointsFor += sb;
      a.pointsAgainst += sb;
      b.pointsAgainst += sa;
      if (sa > sb) {
        a.wins += 1;
        b.losses += 1;
      } else {
        b.wins += 1;
        a.losses += 1;
      }
    }
    const order = [...state.values()].sort(compareStandings);
    order.forEach((t, i) => {
      const c = tally.get(t.id)!;
      if (i < playoffTeams) c.playoff += 1;
      if (i < byes) c.bye += 1;
      if (i === order.length - 1) c.last += 1;
    });
    // Play out the bracket (re-seeded: best remaining seed meets the worst).
    let alive = order.slice(0, playoffTeams).map((t) => t.id);
    let roundOne = true;
    while (alive.length > 1) {
      const advancing = roundOne ? alive.slice(0, byes) : [];
      const playing = roundOne ? alive.slice(byes) : alive;
      const winners: string[] = [];
      for (let i = 0, j = playing.length - 1; i < j; i += 1, j -= 1) {
        winners.push(draw(playing[i]) >= draw(playing[j]) ? playing[i] : playing[j]);
      }
      if (playing.length % 2 === 1) winners.push(playing[Math.floor(playing.length / 2)]);
      alive = [...advancing, ...winners].sort((x, y) => order.findIndex((t) => t.id === x) - order.findIndex((t) => t.id === y));
      roundOne = false;
    }
    if (alive[0]) tally.get(alive[0])!.title += 1;
  }

  // Exact clinch / elimination on wins alone.
  const gamesLeft = new Map(teams.map((t) => [t.id, remaining.filter((g) => g.a === t.id || g.b === t.id).length]));
  const out = new Map<string, TeamOdds>();
  for (const t of teams) {
    const maxWins = t.wins + (gamesLeft.get(t.id) ?? 0);
    const canReach = teams.filter((o) => o.id !== t.id && o.wins + (gamesLeft.get(o.id) ?? 0) >= t.wins).length;
    const surelyAbove = teams.filter((o) => o.id !== t.id && o.wins > maxWins).length;
    const c = tally.get(t.id)!;
    const d = dist.get(t.id)!;
    out.set(t.id, {
      id: t.id,
      playoffPct: (100 * c.playoff) / sims,
      byePct: (100 * c.bye) / sims,
      titlePct: (100 * c.title) / sims,
      lastPct: (100 * c.last) / sims,
      clinched: canReach < playoffTeams,
      eliminated: surelyAbove >= playoffTeams,
      mean: d.mean,
      sd: d.sd,
    });
  }
  return out;
}
