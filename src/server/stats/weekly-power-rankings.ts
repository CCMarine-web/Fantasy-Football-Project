/**
 * WEEKLY POWER RANKINGS — a measure of current team quality.
 *
 * ── What this deliberately is not ──────────────────────────────────────────
 * It is not a standings table and not a season retrospective. Wins and losses
 * are NOT a scoring category, and neither are championships, playoff seeding
 * or final placement. Those record what happened to a team; this estimates how
 * good the team actually is right now. A 4-6 side that keeps losing 130-135 is
 * a better football team than a 6-4 side scraping 95s, and this says so.
 *
 * Head-to-head results still enter the model, but only in forms that strip out
 * schedule luck: all-play win% (your score against EVERY team, every week) and
 * expected wins (the share of the league you out-scored). Neither can be moved
 * by who you happened to be drawn against.
 *
 * ── In-season formula ──────────────────────────────────────────────────────
 * Nine factors, each normalised 0-100 across the league, then blended:
 *
 *   Scoring            22%  recency-weighted points per game
 *   All-play           20%  win% against the whole league each week
 *   Expected wins      12%  wins a team "should" have from weekly rank
 *   Recent form        12%  last three weeks vs. season baseline
 *   Consistency        10%  inverted coefficient of variation
 *   Lineup efficiency   8%  started points / best possible lineup
 *   Starter strength    7%  mean output of the starting lineup
 *   Bench depth         5%  bench scoring, i.e. cover for injuries and byes
 *   Schedule strength   4%  mean opponent quality faced
 *
 * Recency: each week carries weight RECENCY_BASE^(weeksAgo), so the most
 * recent week counts about three times a week from ten weeks earlier while
 * every week still contributes. Nothing is discarded.
 *
 * ── Preseason formula ──────────────────────────────────────────────────────
 * With no games played there is nothing to measure, so the model switches
 * inputs rather than pretending. Draft capital, roster depth and the
 * manager's own multi-season scoring baseline stand in until week 1 posts,
 * and the UI is told which mode produced the numbers.
 *
 * Everything here is pure and deterministic. AI never computes a rank; it only
 * writes commentary about numbers this file produced.
 */

export type RankingMode = "IN_SEASON" | "PRESEASON";

export const IN_SEASON_WEIGHTS = {
  scoring: 0.22,
  allPlay: 0.2,
  expectedWins: 0.12,
  recentForm: 0.12,
  consistency: 0.1,
  lineupEfficiency: 0.08,
  starterStrength: 0.07,
  benchDepth: 0.05,
  scheduleStrength: 0.04,
} as const;

export const PRESEASON_WEIGHTS = {
  draftCapital: 0.34,
  rosterDepth: 0.22,
  historicalScoring: 0.3,
  historicalConsistency: 0.14,
} as const;

export type InSeasonFactorKey = keyof typeof IN_SEASON_WEIGHTS;
export type PreseasonFactorKey = keyof typeof PRESEASON_WEIGHTS;
export type FactorKey = InSeasonFactorKey | PreseasonFactorKey;

export const FACTOR_META: Record<FactorKey, { label: string; description: string }> = {
  scoring: {
    label: "Scoring",
    description: "Points per game, with recent weeks weighted more heavily than early ones.",
  },
  allPlay: {
    label: "All-play win%",
    description:
      "Your score compared against every other team's, every week. Removes schedule luck entirely — you cannot be rewarded for an easy draw.",
  },
  expectedWins: {
    label: "Expected wins",
    description:
      "The wins a team should have, from how many teams it out-scored each week. Measures earned results rather than actual ones.",
  },
  recentForm: {
    label: "Recent form",
    description:
      "The last three weeks measured against the team's own season average — who is heating up or fading.",
  },
  consistency: {
    label: "Consistency",
    description:
      "Week-to-week variation relative to average score, inverted. A steady 120 is worth more than 90-then-150.",
  },
  lineupEfficiency: {
    label: "Lineup efficiency",
    description:
      "Points actually started as a share of the best lineup available that week — how well the manager sets a lineup.",
  },
  starterStrength: {
    label: "Starter strength",
    description:
      "Average output of the players in starting slots, i.e. the quality of the first-choice roster.",
  },
  benchDepth: {
    label: "Bench depth",
    description: "Scoring available on the bench — cover for injuries and bye weeks.",
  },
  scheduleStrength: {
    label: "Schedule strength",
    description:
      "Average quality of opponents faced so far, so a hard slate is not held against a team.",
  },
  draftCapital: {
    label: "Draft capital",
    description:
      "Value of the roster assembled at the draft, from pick position and how early each player went.",
  },
  rosterDepth: {
    label: "Roster depth",
    description: "Playable bodies at each position beyond the starting lineup.",
  },
  historicalScoring: {
    label: "Historical scoring",
    description:
      "The manager's scoring rate across previous seasons, as a baseline until real games post.",
  },
  historicalConsistency: {
    label: "Historical consistency",
    description: "How reliably the manager has scored in previous seasons.",
  },
};

/** Weekly result for one team. */
export interface WeeklyLine {
  week: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Sum of started players' points; null when player-level data is unavailable. */
  starterPoints?: number | null;
  /** Best lineup that could have been started from the same roster. */
  optimalPoints?: number | null;
  /** Total bench output that week. */
  benchPoints?: number | null;
}

export interface TeamRankingInput {
  fantasyTeamId: string;
  managerId: string | null;
  managerName: string;
  teamName: string;
  weeks: WeeklyLine[];
  /** Preseason only: total draft-capital score (see buildDraftCapital). */
  draftCapital?: number | null;
  /** Preseason only: number of rostered players beyond a standard starting nine. */
  rosterDepth?: number | null;
  /** Preseason only: the manager's points per game across prior seasons. */
  historicalPointsPerGame?: number | null;
  /** Preseason only: std dev of the manager's prior-season weekly scores. */
  historicalStdDev?: number | null;
}

export interface RankingFactor {
  key: FactorKey;
  label: string;
  /** 0-100 after normalisation across the league. */
  value: number;
  weight: number;
  /** The underlying number, in human terms. */
  raw: string;
}

export interface PowerRankingRow {
  rank: number;
  previousRank: number | null;
  fantasyTeamId: string;
  managerId: string | null;
  managerName: string;
  teamName: string;
  /** 0-100 composite. */
  score: number;
  weightedPointsPerGame: number | null;
  allPlayWins: number;
  allPlayLosses: number;
  allPlayTies: number;
  allPlayPct: number;
  expectedWins: number | null;
  actualWins: number;
  /** expectedWins - actualWins; positive means the team has been unlucky. */
  luck: number | null;
  lineupEfficiency: number | null;
  factors: RankingFactor[];
}

export interface PowerRankingsResult {
  mode: RankingMode;
  /** Highest completed week that fed the ranking; 0 in preseason. */
  throughWeek: number;
  weeksCounted: number;
  rows: PowerRankingRow[];
  /** Factors actually used, in display order, with their weights. */
  weights: { key: FactorKey; label: string; description: string; weight: number }[];
  /** Set when player-level data was missing, so the UI can say so. */
  notes: string[];
}

/**
 * How quickly older weeks fade. 0.88 means a week counts ~12% less than the
 * one after it, so week 10 of 12 carries roughly 1.3x week 5 and about 3x a
 * week ten earlier — recent form matters without erasing the season.
 */
const RECENCY_BASE = 0.88;
const RECENT_FORM_WINDOW = 3;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length);
}

/** Min-max to 0-100; a flat field maps everyone to 50 rather than dividing by zero. */
function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 50;
  if (max - min < 1e-9) return 50;
  return ((value - min) / (max - min)) * 100;
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Recency-weighted mean of a team's weekly points. */
function weightedPointsPerGame(weeks: WeeklyLine[], latestWeek: number): number {
  if (weeks.length === 0) return 0;
  let weightSum = 0;
  let total = 0;
  for (const w of weeks) {
    const weight = RECENCY_BASE ** Math.max(0, latestWeek - w.week);
    total += w.pointsFor * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

export function computeWeeklyPowerRankings(
  teams: TeamRankingInput[],
  previousOrder?: string[],
): PowerRankingsResult {
  const prevRank = new Map((previousOrder ?? []).map((id, i) => [id, i + 1]));
  if (teams.length === 0) {
    return { mode: "IN_SEASON", throughWeek: 0, weeksCounted: 0, rows: [], weights: [], notes: [] };
  }

  const playedWeeks = new Set<number>();
  for (const t of teams) for (const w of t.weeks) playedWeeks.add(w.week);
  const throughWeek = playedWeeks.size > 0 ? Math.max(...playedWeeks) : 0;

  return playedWeeks.size === 0
    ? preseasonRankings(teams, prevRank)
    : inSeasonRankings(teams, throughWeek, playedWeeks.size, prevRank);
}

// ---------------------------------------------------------------------------
// In-season
// ---------------------------------------------------------------------------

function inSeasonRankings(
  teams: TeamRankingInput[],
  throughWeek: number,
  weeksCounted: number,
  prevRank: Map<string, number>,
): PowerRankingsResult {
  const notes: string[] = [];

  // All-play and weekly rank, per week, across the league.
  const byWeek = new Map<number, { id: string; points: number }[]>();
  for (const t of teams) {
    for (const w of t.weeks) {
      const list = byWeek.get(w.week) ?? [];
      list.push({ id: t.fantasyTeamId, points: w.pointsFor });
      byWeek.set(w.week, list);
    }
  }

  const allPlay = new Map<string, { w: number; l: number; t: number }>();
  const expected = new Map<string, number>();
  for (const t of teams) {
    allPlay.set(t.fantasyTeamId, { w: 0, l: 0, t: 0 });
    expected.set(t.fantasyTeamId, 0);
  }
  for (const entries of byWeek.values()) {
    const opponents = entries.length - 1;
    for (const a of entries) {
      const rec = allPlay.get(a.id)!;
      let beaten = 0;
      for (const b of entries) {
        if (a.id === b.id) continue;
        if (a.points > b.points) {
          rec.w++;
          beaten++;
        } else if (a.points < b.points) rec.l++;
        else rec.t++;
      }
      // Expected wins: the share of the league you out-scored that week is the
      // probability you'd have beaten a random opponent.
      if (opponents > 0) expected.set(a.id, (expected.get(a.id) ?? 0) + beaten / opponents);
    }
  }

  const hasPlayerData = teams.some((t) =>
    t.weeks.some((w) => w.optimalPoints != null && w.optimalPoints > 0),
  );
  if (!hasPlayerData) {
    notes.push(
      "Lineup efficiency, starter strength and bench depth are unavailable for this season (no player-level scoring on record), so their weight is redistributed across the remaining factors.",
    );
  }

  const metrics = teams.map((t) => {
    const scores = t.weeks.map((w) => w.pointsFor);
    const wpg = weightedPointsPerGame(t.weeks, throughWeek);
    const seasonMean = mean(scores);
    const recent = t.weeks
      .filter((w) => w.week > throughWeek - RECENT_FORM_WINDOW)
      .map((w) => w.pointsFor);
    // Form as a ratio to the team's own baseline, so it measures trend rather
    // than simply re-measuring scoring.
    const form = seasonMean > 0 && recent.length > 0 ? mean(recent) / seasonMean : 1;
    const sd = stdDev(scores);
    // Coefficient of variation, so a high-scoring team isn't penalised for
    // having larger absolute swings.
    const cv = seasonMean > 0 ? sd / seasonMean : 0;

    const withLineups = t.weeks.filter((w) => w.optimalPoints != null && w.optimalPoints > 0);
    const efficiency =
      withLineups.length > 0
        ? mean(withLineups.map((w) => (w.starterPoints ?? 0) / (w.optimalPoints as number)))
        : null;
    const starter =
      withLineups.length > 0 ? mean(withLineups.map((w) => w.starterPoints ?? 0)) : null;
    const benchWeeks = t.weeks.filter((w) => w.benchPoints != null);
    const bench =
      benchWeeks.length > 0 ? mean(benchWeeks.map((w) => w.benchPoints as number)) : null;

    const ap = allPlay.get(t.fantasyTeamId)!;
    const apTotal = ap.w + ap.l + ap.t;

    return {
      team: t,
      wpg,
      seasonMean,
      form,
      cv,
      efficiency,
      starter,
      bench,
      sos: mean(t.weeks.map((w) => w.pointsAgainst)),
      allPlay: ap,
      allPlayPct: apTotal > 0 ? (ap.w + 0.5 * ap.t) / apTotal : 0,
      expectedWins: expected.get(t.fantasyTeamId) ?? 0,
      actualWins: t.weeks.filter((w) => w.pointsFor > w.pointsAgainst).length,
    };
  });

  const range = (pick: (m: (typeof metrics)[number]) => number | null) => {
    const vals = metrics.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
    return vals.length > 0
      ? { min: Math.min(...vals), max: Math.max(...vals) }
      : { min: 0, max: 0 };
  };

  const rScoring = range((m) => m.wpg);
  const rAllPlay = range((m) => m.allPlayPct);
  const rExpected = range((m) => m.expectedWins);
  const rForm = range((m) => m.form);
  const rCv = range((m) => m.cv);
  const rEff = range((m) => m.efficiency);
  const rStarter = range((m) => m.starter);
  const rBench = range((m) => m.bench);
  const rSos = range((m) => m.sos);

  // When player-level data is missing the three lineup factors can't be
  // computed. Rather than scoring everyone 50 (which silently shrinks the
  // spread), drop them and renormalise the remaining weights to sum to 1.
  const activeKeys: InSeasonFactorKey[] = (
    Object.keys(IN_SEASON_WEIGHTS) as InSeasonFactorKey[]
  ).filter((k) =>
    hasPlayerData
      ? true
      : k !== "lineupEfficiency" && k !== "starterStrength" && k !== "benchDepth",
  );
  const weightTotal = activeKeys.reduce((sum, k) => sum + IN_SEASON_WEIGHTS[k], 0);
  const weightOf = (k: InSeasonFactorKey) => IN_SEASON_WEIGHTS[k] / weightTotal;

  const rows = metrics.map((m) => {
    const values: Record<InSeasonFactorKey, number> = {
      scoring: normalize(m.wpg, rScoring.min, rScoring.max),
      allPlay: normalize(m.allPlayPct, rAllPlay.min, rAllPlay.max),
      expectedWins: normalize(m.expectedWins, rExpected.min, rExpected.max),
      recentForm: normalize(m.form, rForm.min, rForm.max),
      // Lower variation is better.
      consistency: 100 - normalize(m.cv, rCv.min, rCv.max),
      lineupEfficiency: m.efficiency == null ? 50 : normalize(m.efficiency, rEff.min, rEff.max),
      starterStrength: m.starter == null ? 50 : normalize(m.starter, rStarter.min, rStarter.max),
      benchDepth: m.bench == null ? 50 : normalize(m.bench, rBench.min, rBench.max),
      // A tougher schedule (more points allowed) is a credit, not a penalty.
      scheduleStrength: normalize(m.sos, rSos.min, rSos.max),
    };

    const raws: Record<InSeasonFactorKey, string> = {
      scoring: `${round(m.wpg)} pts/gm`,
      allPlay: `${m.allPlay.w}-${m.allPlay.l}${m.allPlay.t ? `-${m.allPlay.t}` : ""}`,
      expectedWins: `${round(m.expectedWins)} exp. wins`,
      recentForm: `${m.form >= 1 ? "+" : ""}${round((m.form - 1) * 100)}% vs season`,
      consistency: `±${round(m.cv * 100)}% variation`,
      lineupEfficiency:
        m.efficiency == null ? "no data" : `${round(m.efficiency * 100)}% of optimal`,
      starterStrength: m.starter == null ? "no data" : `${round(m.starter)} starter pts`,
      benchDepth: m.bench == null ? "no data" : `${round(m.bench)} bench pts`,
      scheduleStrength: `${round(m.sos)} pts allowed/gm`,
    };

    const factors: RankingFactor[] = activeKeys.map((key) => ({
      key,
      label: FACTOR_META[key].label,
      value: round(values[key]),
      weight: round(weightOf(key), 3),
      raw: raws[key],
    }));

    const score = activeKeys.reduce((sum, key) => sum + values[key] * weightOf(key), 0);

    return {
      fantasyTeamId: m.team.fantasyTeamId,
      managerId: m.team.managerId,
      managerName: m.team.managerName,
      teamName: m.team.teamName,
      score: round(score),
      weightedPointsPerGame: round(m.wpg),
      allPlayWins: m.allPlay.w,
      allPlayLosses: m.allPlay.l,
      allPlayTies: m.allPlay.t,
      allPlayPct: round(m.allPlayPct, 3),
      expectedWins: round(m.expectedWins),
      actualWins: m.actualWins,
      luck: round(m.actualWins - m.expectedWins),
      lineupEfficiency: m.efficiency == null ? null : round(m.efficiency * 100),
      factors,
    };
  });

  rows.sort(
    (a, b) =>
      b.score - a.score ||
      b.weightedPointsPerGame! - a.weightedPointsPerGame! ||
      a.managerName.localeCompare(b.managerName),
  );

  return {
    mode: "IN_SEASON",
    throughWeek,
    weeksCounted,
    notes,
    weights: activeKeys.map((key) => ({
      key,
      label: FACTOR_META[key].label,
      description: FACTOR_META[key].description,
      weight: round(weightOf(key), 3),
    })),
    rows: rows.map((r, i) => ({
      ...r,
      rank: i + 1,
      previousRank: prevRank.get(r.fantasyTeamId) ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Preseason
// ---------------------------------------------------------------------------

function preseasonRankings(
  teams: TeamRankingInput[],
  prevRank: Map<string, number>,
): PowerRankingsResult {
  const notes = [
    "No games have been played yet, so this is a projection: it uses draft capital, roster depth and each manager's multi-season scoring baseline. It switches to live results automatically once week 1 is final.",
  ];

  const range = (pick: (t: TeamRankingInput) => number | null | undefined) => {
    const vals = teams.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
    return vals.length > 0
      ? { min: Math.min(...vals), max: Math.max(...vals) }
      : { min: 0, max: 0 };
  };
  const rDraft = range((t) => t.draftCapital);
  const rDepth = range((t) => t.rosterDepth);
  const rHist = range((t) => t.historicalPointsPerGame);
  const rHistSd = range((t) => t.historicalStdDev);

  const rows = teams.map((t) => {
    const values: Record<PreseasonFactorKey, number> = {
      draftCapital: t.draftCapital == null ? 50 : normalize(t.draftCapital, rDraft.min, rDraft.max),
      rosterDepth: t.rosterDepth == null ? 50 : normalize(t.rosterDepth, rDepth.min, rDepth.max),
      historicalScoring:
        t.historicalPointsPerGame == null
          ? 50
          : normalize(t.historicalPointsPerGame, rHist.min, rHist.max),
      historicalConsistency:
        t.historicalStdDev == null
          ? 50
          : 100 - normalize(t.historicalStdDev, rHistSd.min, rHistSd.max),
    };
    const raws: Record<PreseasonFactorKey, string> = {
      draftCapital:
        t.draftCapital == null ? "no draft on record" : `${round(t.draftCapital)} capital`,
      rosterDepth: t.rosterDepth == null ? "no roster on record" : `${t.rosterDepth} bench players`,
      historicalScoring:
        t.historicalPointsPerGame == null
          ? "no prior seasons"
          : `${round(t.historicalPointsPerGame)} pts/gm`,
      historicalConsistency:
        t.historicalStdDev == null ? "no prior seasons" : `±${round(t.historicalStdDev)} std dev`,
    };

    const keys = Object.keys(PRESEASON_WEIGHTS) as PreseasonFactorKey[];
    const factors: RankingFactor[] = keys.map((key) => ({
      key,
      label: FACTOR_META[key].label,
      value: round(values[key]),
      weight: PRESEASON_WEIGHTS[key],
      raw: raws[key],
    }));
    const score = keys.reduce((sum, key) => sum + values[key] * PRESEASON_WEIGHTS[key], 0);

    return {
      fantasyTeamId: t.fantasyTeamId,
      managerId: t.managerId,
      managerName: t.managerName,
      teamName: t.teamName,
      score: round(score),
      weightedPointsPerGame:
        t.historicalPointsPerGame == null ? null : round(t.historicalPointsPerGame),
      allPlayWins: 0,
      allPlayLosses: 0,
      allPlayTies: 0,
      allPlayPct: 0,
      expectedWins: null,
      actualWins: 0,
      luck: null,
      lineupEfficiency: null,
      factors,
    };
  });

  rows.sort((a, b) => b.score - a.score || a.managerName.localeCompare(b.managerName));

  return {
    mode: "PRESEASON",
    throughWeek: 0,
    weeksCounted: 0,
    notes,
    weights: (Object.keys(PRESEASON_WEIGHTS) as PreseasonFactorKey[]).map((key) => ({
      key,
      label: FACTOR_META[key].label,
      description: FACTOR_META[key].description,
      weight: PRESEASON_WEIGHTS[key],
    })),
    rows: rows.map((r, i) => ({
      ...r,
      rank: i + 1,
      previousRank: prevRank.get(r.fantasyTeamId) ?? null,
    })),
  };
}

/**
 * Draft capital for a team: each pick is worth more the earlier it was made,
 * on a decay curve rather than a straight line, because the gap between picks
 * 1 and 10 is far larger than between 100 and 110.
 */
export function draftCapitalScore(overallPickNumbers: number[]): number {
  return overallPickNumbers.reduce((sum, pick) => sum + 100 / Math.sqrt(Math.max(1, pick)), 0);
}
