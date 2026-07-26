/**
 * FINAL-SEASON power rankings — "where everyone actually finished", computed
 * from a completed season's verified results.
 *
 * This is deliberately different from an in-season power ranking: nothing here
 * is a projection, and every input is a settled fact by the time it runs.
 *
 * ── The formula ────────────────────────────────────────────────────────────
 * Five factors, each normalised to 0-100 across the ten teams in that season,
 * then blended with fixed weights:
 *
 *   Postseason      30%  discrete result tier (see POSTSEASON_POINTS)
 *   Record          26%  regular-season win% ((W + 0.5T) / games)
 *   Scoring         20%  total regular-season points for
 *   Strength        14%  all-play win% — your score vs EVERY team each week,
 *                        which removes schedule luck
 *   Consistency     10%  inverted standard deviation of weekly scores
 *
 * Postseason carries the largest single weight deliberately: this ranks a
 * FINISHED season, and how far a team actually went is the most meaningful
 * thing about it. It outweighs Record so a champion can never be ranked below
 * a team that missed the playoffs entirely.
 *
 * Regular-season games only feed the first four factors. Playoff teams play
 * more games, so including postseason scores would inflate their cumulative
 * totals and double-count the run that the Postseason factor already measures.
 *
 * Normalisation is min-max within the season, so the factor scores are
 * explicitly RELATIVE: the season's best team scores 100 on a factor and the
 * worst scores 0. The blended score is therefore a within-season comparison,
 * not a cross-era rating. When every team ties on a factor, all get 50.
 *
 * Everything in this file is pure and deterministic — the same season always
 * produces the same ranking. AI never touches the numbers; it only writes
 * commentary about them elsewhere.
 */

export const POWER_WEIGHTS = {
  postseason: 0.3,
  record: 0.26,
  scoring: 0.2,
  strength: 0.14,
  consistency: 0.1,
} as const;

/** Discrete postseason outcome, most to least valuable. */
export type PostseasonResult = "CHAMPION" | "RUNNER_UP" | "THIRD" | "MADE_PLAYOFFS" | "MISSED_PLAYOFFS";

/**
 * Raw points for each postseason outcome (pre-normalisation). A discrete
 * ladder is used because finishing position below third place isn't recorded
 * for every season — inventing an ordering there would be fabricating data.
 */
export const POSTSEASON_POINTS: Record<PostseasonResult, number> = {
  CHAMPION: 100,
  RUNNER_UP: 85,
  THIRD: 70,
  MADE_PLAYOFFS: 50,
  MISSED_PLAYOFFS: 0,
};

export const POSTSEASON_LABELS: Record<PostseasonResult, string> = {
  CHAMPION: "Champion",
  RUNNER_UP: "Runner-up",
  THIRD: "Third place",
  MADE_PLAYOFFS: "Made playoffs",
  MISSED_PLAYOFFS: "Missed playoffs",
};

export interface SeasonTeamInput {
  fantasyTeamId: string;
  managerId: string | null;
  managerName: string;
  teamName: string;
  /** Regular-season weekly scores, one entry per played week. */
  weeklyScores: { week: number; score: number }[];
  wins: number;
  losses: number;
  ties: number;
  postseason: PostseasonResult;
}

export interface PowerFactor {
  key: keyof typeof POWER_WEIGHTS;
  label: string;
  /** 0-100 after normalisation. */
  value: number;
  weight: number;
  /** Human-readable underlying number, e.g. "11-3" or "1,891.2 pts". */
  raw: string;
}

export interface SeasonPowerRow {
  rank: number;
  fantasyTeamId: string;
  managerId: string | null;
  managerName: string;
  teamName: string;
  score: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  pointsFor: number;
  allPlayWins: number;
  allPlayLosses: number;
  allPlayTies: number;
  stdDev: number;
  postseason: PostseasonResult;
  factors: PowerFactor[];
}

export const FACTOR_LABELS: Record<keyof typeof POWER_WEIGHTS, string> = {
  record: "Record",
  scoring: "Scoring",
  strength: "Strength",
  consistency: "Consistency",
  postseason: "Postseason",
};

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Min-max to 0-100; a flat field maps everyone to 50. */
function normalize(value: number, min: number, max: number): number {
  if (max - min < 1e-9) return 50;
  return ((value - min) / (max - min)) * 100;
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * Ranks one completed season. Teams with no recorded weekly scores are still
 * returned (with zeroed factors) rather than silently dropped.
 */
export function computeSeasonPowerRankings(teams: SeasonTeamInput[]): SeasonPowerRow[] {
  if (teams.length === 0) return [];

  // All-play: each week, compare every team's score against every other team's.
  const weeks = new Map<number, { id: string; score: number }[]>();
  for (const t of teams) {
    for (const g of t.weeklyScores) {
      const list = weeks.get(g.week) ?? [];
      list.push({ id: t.fantasyTeamId, score: g.score });
      weeks.set(g.week, list);
    }
  }

  const allPlay = new Map<string, { w: number; l: number; t: number }>();
  for (const t of teams) allPlay.set(t.fantasyTeamId, { w: 0, l: 0, t: 0 });
  for (const entries of weeks.values()) {
    for (const a of entries) {
      const rec = allPlay.get(a.id)!;
      for (const b of entries) {
        if (a.id === b.id) continue;
        if (a.score > b.score) rec.w++;
        else if (a.score < b.score) rec.l++;
        else rec.t++;
      }
    }
  }

  // Raw per-team metrics.
  const raw = teams.map((t) => {
    const scores = t.weeklyScores.map((g) => g.score);
    const games = t.wins + t.losses + t.ties;
    const ap = allPlay.get(t.fantasyTeamId)!;
    const apTotal = ap.w + ap.l + ap.t;
    return {
      team: t,
      winPct: games > 0 ? (t.wins + 0.5 * t.ties) / games : 0,
      pointsFor: scores.reduce((s, v) => s + v, 0),
      allPlayPct: apTotal > 0 ? (ap.w + 0.5 * ap.t) / apTotal : 0,
      allPlay: ap,
      sd: stdDev(scores),
      postseasonPoints: POSTSEASON_POINTS[t.postseason],
    };
  });

  const range = (pick: (r: (typeof raw)[number]) => number) => {
    const vals = raw.map(pick);
    return { min: Math.min(...vals), max: Math.max(...vals) };
  };
  const rWin = range((r) => r.winPct);
  const rPts = range((r) => r.pointsFor);
  const rAll = range((r) => r.allPlayPct);
  const rSd = range((r) => r.sd);
  const rPost = range((r) => r.postseasonPoints);

  const rows = raw.map((r) => {
    const fRecord = normalize(r.winPct, rWin.min, rWin.max);
    const fScoring = normalize(r.pointsFor, rPts.min, rPts.max);
    const fStrength = normalize(r.allPlayPct, rAll.min, rAll.max);
    // Lower deviation is better, so invert.
    const fConsistency = 100 - normalize(r.sd, rSd.min, rSd.max);
    const fPostseason = normalize(r.postseasonPoints, rPost.min, rPost.max);

    const score =
      fRecord * POWER_WEIGHTS.record +
      fScoring * POWER_WEIGHTS.scoring +
      fStrength * POWER_WEIGHTS.strength +
      fConsistency * POWER_WEIGHTS.consistency +
      fPostseason * POWER_WEIGHTS.postseason;

    const recordLabel = `${r.team.wins}-${r.team.losses}${r.team.ties ? `-${r.team.ties}` : ""}`;
    const factors: PowerFactor[] = [
      { key: "record", label: FACTOR_LABELS.record, value: round(fRecord), weight: POWER_WEIGHTS.record, raw: recordLabel },
      { key: "scoring", label: FACTOR_LABELS.scoring, value: round(fScoring), weight: POWER_WEIGHTS.scoring, raw: `${round(r.pointsFor).toLocaleString()} pts` },
      { key: "strength", label: FACTOR_LABELS.strength, value: round(fStrength), weight: POWER_WEIGHTS.strength, raw: `${r.allPlay.w}-${r.allPlay.l}${r.allPlay.t ? `-${r.allPlay.t}` : ""} all-play` },
      { key: "consistency", label: FACTOR_LABELS.consistency, value: round(fConsistency), weight: POWER_WEIGHTS.consistency, raw: `±${round(r.sd)} std dev` },
      { key: "postseason", label: FACTOR_LABELS.postseason, value: round(fPostseason), weight: POWER_WEIGHTS.postseason, raw: POSTSEASON_LABELS[r.team.postseason] },
    ];

    return {
      fantasyTeamId: r.team.fantasyTeamId,
      managerId: r.team.managerId,
      managerName: r.team.managerName,
      teamName: r.team.teamName,
      score: round(score),
      wins: r.team.wins,
      losses: r.team.losses,
      ties: r.team.ties,
      winPct: round(r.winPct, 3),
      pointsFor: round(r.pointsFor),
      allPlayWins: r.allPlay.w,
      allPlayLosses: r.allPlay.l,
      allPlayTies: r.allPlay.t,
      stdDev: round(r.sd),
      postseason: r.team.postseason,
      factors,
    };
  });

  // Ties break on total points, then name so the order is fully deterministic.
  rows.sort(
    (a, b) => b.score - a.score || b.pointsFor - a.pointsFor || a.managerName.localeCompare(b.managerName),
  );
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
