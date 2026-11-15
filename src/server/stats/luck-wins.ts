/**
 * LUCK, IN WINS — the site's one luck number (Nov 2026 update).
 *
 *   luckWins = actual wins − expected wins
 *
 * Expected wins, per week, are the share of the league a team out-scored that
 * week: p = (teams out-scored + 0.5 × teams tied) ÷ (teams − 1), using the
 * teams that actually played that week (2017 had 8, later seasons 10). Summed
 * over COMPLETED REGULAR-SEASON weeks only — no playoff, consolation, unplayed
 * or in-progress games.
 *
 * Labels come from a sample-size-aware z-score, so a 9-game season and a
 * 135-game career are on the same footing:
 *
 *   z = luckWins ÷ sqrt(Σ pᵢ(1 − pᵢ))
 *   |z| < 0.5 Neutral · 0.5–1 Slightly · 1–2 Lucky/Unlucky · > 2 Extremely
 *   under 6 games: "Not enough games"
 *
 * This replaces the 0–100 composite, which blended five components on fixed,
 * rate-based scales (a 9-game season and a career were not comparable, three
 * playoff games could cancel a career's win surplus, and its schedule-strength
 * input sat at 48–51 for everyone because nobody plays themselves).
 *
 * The other measures are kept as CONTEXT, never blended in:
 *   opponent scoring  each opponent's score vs that week's league average
 *                     excluding the manager's own score
 *   close games       record in games decided by under 5 points
 *   playoff draw      championship-bracket opponents vs their season average,
 *                     with the game count
 */

export const MIN_LUCK_GAMES = 6;
export const CLOSE_MARGIN = 5;

/** One side of one verified game, from the verified-games loader. */
export interface LuckGameRow {
  managerId: string;
  opponentManagerId: string;
  year: number;
  week: number;
  isPlayoff: boolean;
  bracket: string | null;
  score: number;
  opponentScore: number;
  /** Platform result, used only to break exact ties on points. */
  isWinner: boolean | null;
}

export interface LuckContext {
  opponentScoring: { perGame: number; games: number } | null;
  closeGames: { wins: number; losses: number; games: number };
  playoffDraw: { pctAboveAverage: number; games: number } | null;
}

export interface LuckWins {
  games: number;
  /** Actual wins, a tie counting half. */
  wins: number;
  expected: number;
  luckWins: number;
  /** Null under MIN_LUCK_GAMES. */
  z: number | null;
  label: string;
  tone: "lucky" | "unlucky" | "neutral" | "insufficient";
  context: LuckContext;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function luckLabelFromZ(luckWins: number, z: number | null, games: number): { label: string; tone: LuckWins["tone"] } {
  if (games < MIN_LUCK_GAMES || z == null) return { label: "Not enough games", tone: "insufficient" };
  const a = Math.abs(z);
  if (a < 0.5) return { label: "Neutral", tone: "neutral" };
  const side = luckWins > 0 ? "Lucky" : "Unlucky";
  const tone = luckWins > 0 ? "lucky" : "unlucky";
  if (a < 1) return { label: `Slightly ${side}`, tone };
  if (a <= 2) return { label: side, tone };
  return { label: `Extremely ${side}`, tone };
}

/** Ordinal strength of a label, for monotonicity checks and sorting: −3 … +3. */
export function labelRank(label: string): number {
  const order = ["Extremely Unlucky", "Unlucky", "Slightly Unlucky", "Neutral", "Slightly Lucky", "Lucky", "Extremely Lucky"];
  const i = order.indexOf(label);
  return i < 0 ? 0 : i - 3;
}

function actualResult(g: LuckGameRow): number {
  if (g.score > g.opponentScore) return 1;
  if (g.score < g.opponentScore) return 0;
  return g.isWinner === true ? 1 : g.isWinner === false ? 0 : 0.5;
}

interface WeekPool {
  scores: { managerId: string; score: number }[];
  mean: number;
}

/** Completed regular-season weeks: every team that played a verified game that week. */
function weekPools(rows: LuckGameRow[]): Map<string, WeekPool> {
  const pools = new Map<string, WeekPool>();
  for (const r of rows) {
    if (r.isPlayoff) continue;
    const key = `${r.year}-${r.week}`;
    const pool = pools.get(key) ?? { scores: [], mean: 0 };
    pool.scores.push({ managerId: r.managerId, score: r.score });
    pools.set(key, pool);
  }
  for (const pool of pools.values()) pool.mean = pool.scores.reduce((s, x) => s + x.score, 0) / pool.scores.length;
  return pools;
}

/** Expected-win value of one score in its week. */
export function weekExpected(pool: { score: number }[], score: number): number {
  const n = pool.length;
  if (n < 2) return 0;
  let out = 0;
  let tied = 0;
  for (const s of pool) {
    if (s.score < score) out += 1;
    else if (s.score === score) tied += 1;
  }
  tied -= 1; // the team itself
  return (out + 0.5 * tied) / (n - 1);
}

/**
 * Luck for every manager over the rows given (a season's rows for a season
 * figure, every season's for a career figure — the maths does not change).
 * `seasonAverages` (managerId|year -> regular-season PPG) feeds the playoff draw.
 */
export function computeLuckWins(rows: LuckGameRow[]): Map<string, LuckWins> {
  const pools = weekPools(rows);
  // Season PPG per manager, for the playoff-draw context.
  const ppg = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.isPlayoff) continue;
    const k = `${r.managerId}|${r.year}`;
    const v = ppg.get(k) ?? { sum: 0, n: 0 };
    v.sum += r.score;
    v.n += 1;
    ppg.set(k, v);
  }

  const acc = new Map<
    string,
    { games: number; wins: number; expected: number; variance: number; oppDiff: number; oppGames: number; cw: number; cl: number; po: number[]; }
  >();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) {
      a = { games: 0, wins: 0, expected: 0, variance: 0, oppDiff: 0, oppGames: 0, cw: 0, cl: 0, po: [] };
      acc.set(id, a);
    }
    return a;
  };

  for (const r of rows) {
    const a = get(r.managerId);
    if (r.isPlayoff) {
      if (r.bracket === "WINNERS") {
        const base = ppg.get(`${r.opponentManagerId}|${r.year}`);
        if (base && base.n > 0) a.po.push((r.opponentScore - base.sum / base.n) / (base.sum / base.n));
      }
      continue;
    }
    const pool = pools.get(`${r.year}-${r.week}`);
    if (!pool) continue;
    const p = weekExpected(pool.scores, r.score);
    a.games += 1;
    a.wins += actualResult(r);
    a.expected += p;
    a.variance += p * (1 - p);
    // Opponent vs the same week's field, the manager's own score excluded.
    if (pool.scores.length > 1) {
      const others = (pool.mean * pool.scores.length - r.score) / (pool.scores.length - 1);
      a.oppDiff += r.opponentScore - others;
      a.oppGames += 1;
    }
    const margin = Math.abs(r.score - r.opponentScore);
    if (margin < CLOSE_MARGIN && r.score !== r.opponentScore) {
      if (r.score > r.opponentScore) a.cw += 1;
      else a.cl += 1;
    }
  }

  const out = new Map<string, LuckWins>();
  for (const [id, a] of acc) {
    const luckWins = a.wins - a.expected;
    const z = a.games >= MIN_LUCK_GAMES && a.variance > 0 ? luckWins / Math.sqrt(a.variance) : null;
    const { label, tone } = luckLabelFromZ(luckWins, z, a.games);
    out.set(id, {
      games: a.games,
      wins: a.wins,
      expected: a.expected,
      luckWins,
      z,
      label,
      tone,
      context: {
        opponentScoring: a.oppGames ? { perGame: r1(a.oppDiff / a.oppGames), games: a.oppGames } : null,
        closeGames: { wins: a.cw, losses: a.cl, games: a.cw + a.cl },
        playoffDraw: a.po.length ? { pctAboveAverage: r1((a.po.reduce((s, x) => s + x, 0) / a.po.length) * 100), games: a.po.length } : null,
      },
    });
  }
  return out;
}

/** "+2.1 wins" / "−2.8 wins". */
export function formatLuckWins(luckWins: number): string {
  const v = Math.round(luckWins * 10) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} wins`;
}

/**
 * Competition ranking at the precision the site shows (one decimal), so two
 * teams both shown at "+2.1 wins" share a rank instead of one page calling the
 * first "luckiest" and another page calling the second the same thing.
 */
export function rankLuckWins<T extends { luckWins: number }>(items: T[]): (T & { rank: number; tied: number; of: number })[] {
  const shown = (v: number) => Math.round(v * 10);
  const sorted = [...items].sort((a, b) => b.luckWins - a.luckWins);
  return sorted.map((x) => ({
    ...x,
    rank: 1 + sorted.filter((y) => shown(y.luckWins) > shown(x.luckWins)).length,
    tied: sorted.filter((y) => shown(y.luckWins) === shown(x.luckWins)).length,
    of: sorted.length,
  }));
}

/** "luckiest", "tied-luckiest", "unluckiest", "3 of 10", "tied 3rd of 10". */
export function luckRankText({ rank, tied, of }: { rank: number; tied: number; of: number }): string {
  const t = tied > 1;
  if (rank === 1) return t ? "tied-luckiest" : "luckiest";
  if (rank + tied - 1 === of) return t ? "tied-unluckiest" : "unluckiest";
  return t ? `tied ${rank} of ${of}` : `${rank} of ${of}`;
}
