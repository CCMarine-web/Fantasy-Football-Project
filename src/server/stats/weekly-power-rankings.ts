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
 * ── Before the season: two different questions ─────────────────────────────
 * The old model had one "preseason" mode that mixed draft capital with the
 * manager's scoring history, which meant it produced draft-based numbers in
 * July when no draft had happened. There are two genuinely different questions
 * before week 1, and they now get two different formulas:
 *
 *   MANAGER_BASELINE (before the draft)
 *     Nothing about the coming season exists yet — no roster, no picks. All
 *     that can honestly be ranked is the manager: how much they have scored,
 *     how reliably, how they have fared with schedule luck removed, and what
 *     they are keeping.
 *
 *       Historical scoring       34%
 *       Manager strength         30%   career all-play rate
 *       Historical consistency   20%
 *       Keeper value             16%
 *
 *   PRESEASON (after the draft, before week 1)
 *     Now there is a roster, so the roster is what gets ranked.
 *
 *       Draft capital            28%
 *       Starter quality          22%
 *       Preseason projection     18%
 *       Bench depth              14%
 *       Positional balance       10%
 *       Roster depth              8%
 *
 * ── Missing categories ─────────────────────────────────────────────────────
 * A category with no data behind it is DROPPED and the remaining weights are
 * rescaled to sum to 100%, rather than being scored zero or silently treated
 * as league-average. Scoring it zero would punish a team for a gap in the
 * data; treating it as average would hide the gap. Every dropped category is
 * named in the notes, and the weights shown to a reader are the rescaled ones
 * actually used.
 *
 * Everything here is pure and deterministic. AI never computes a rank; it only
 * writes commentary about numbers this file produced.
 */

export type RankingMode = "IN_SEASON" | "PRESEASON" | "MANAGER_BASELINE";

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

/** After the draft, before week 1: the roster is what gets ranked. */
export const PRESEASON_WEIGHTS = {
  draftCapital: 0.28,
  starterQuality: 0.22,
  projection: 0.18,
  benchDepth: 0.14,
  positionalBalance: 0.1,
  rosterDepth: 0.08,
} as const;

/** Before the draft: only the manager exists to be ranked. */
export const MANAGER_BASELINE_WEIGHTS = {
  historicalScoring: 0.34,
  managerStrength: 0.3,
  historicalConsistency: 0.2,
  keeperValue: 0.16,
} as const;

export type InSeasonFactorKey = keyof typeof IN_SEASON_WEIGHTS;
export type PreseasonFactorKey = keyof typeof PRESEASON_WEIGHTS;
export type BaselineFactorKey = keyof typeof MANAGER_BASELINE_WEIGHTS;
export type FactorKey = InSeasonFactorKey | PreseasonFactorKey | BaselineFactorKey;

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
  starterQuality: {
    label: "Starter quality",
    description:
      "The scoring rate of the drafted players who will start, measured by what those players have actually produced — not by how early they were taken.",
  },
  projection: {
    label: "Preseason projection",
    description:
      "Published preseason projections for the drafted roster. Neither platform's archived data includes these, so this category is normally dropped and its weight redistributed.",
  },
  positionalBalance: {
    label: "Positional balance",
    description:
      "Whether every required starting slot is covered, and how thinly. A roster with no second tight end is one injury from a hole.",
  },
  managerStrength: {
    label: "Manager strength",
    description:
      "Career all-play rate: how often this manager would have beaten a randomly chosen opponent. Schedule luck is removed entirely.",
  },
  keeperValue: {
    label: "Keeper value",
    description:
      "The production of the players carried into the new season. Dropped when no keepers have been declared.",
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
  /** Preseason only: total draft-capital score (see draftCapitalScore). */
  draftCapital?: number | null;
  /** Preseason only: number of rostered players beyond a standard starting nine. */
  rosterDepth?: number | null;
  /** Pre-draft only: the manager's points per game across prior seasons. */
  historicalPointsPerGame?: number | null;
  /** Pre-draft only: std dev of the manager's prior-season weekly scores. */
  historicalStdDev?: number | null;
  /**
   * Pre-draft only: career all-play win rate, 0-1. A schedule-free measure of
   * how good the manager has been, as distinct from how much they scored.
   */
  managerAllPlayRate?: number | null;
  /** Pre-draft only: total prior-season production of declared keepers. */
  keeperValue?: number | null;
  /**
   * Post-draft only: mean prior-season points per game of the drafted players
   * who fill the starting slots. Deliberately NOT derived from where they were
   * picked — draft position measures what a room believed, not what a player
   * produces, and using it would make the ranking a restatement of draft order.
   */
  starterQuality?: number | null;
  /** Post-draft only: mean prior-season points per game of the bench. */
  benchQuality?: number | null;
  /** Post-draft only: 0-1, share of required starting slots with real cover. */
  positionalBalance?: number | null;
  /** Post-draft only: total published preseason projection, when available. */
  projectedPoints?: number | null;
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

  if (playedWeeks.size > 0) {
    return inSeasonRankings(teams, throughWeek, playedWeeks.size, prevRank);
  }

  /*
   * Which pre-season question to answer is decided by the data, not by the
   * calendar: a draft that has produced picks means there are rosters to rank,
   * and no picks means there is nothing yet but the managers themselves.
   */
  const drafted = teams.some((t) => t.draftCapital != null);
  return drafted ? preseasonRankings(teams, prevRank) : baselineRankings(teams, prevRank);
}

// ---------------------------------------------------------------------------
// Shared: blend a set of factors, dropping the ones with no data
// ---------------------------------------------------------------------------

interface FactorSpec {
  key: FactorKey;
  /** 0-100 after normalisation, or null when the category cannot be measured. */
  value: number | null;
  /** Weight before rescaling. */
  weight: number;
  /** Human-readable underlying value, or the reason it is missing. */
  raw: string;
}

/**
 * Combines factors into a 0-100 score, DROPPING any whose value is null and
 * rescaling the survivors so their weights still sum to 1.
 *
 * The alternative — scoring a missing category zero — would rank a team last
 * for a gap in the data rather than for anything they did, and treating it as
 * 50 would quietly pull every team toward the middle without saying so. The
 * weights returned here are the rescaled ones, so what a reader is shown is
 * what was actually used.
 */
function blend(specs: FactorSpec[]): { score: number; factors: RankingFactor[]; dropped: FactorKey[] } {
  const usable = specs.filter((s) => s.value != null);
  const totalWeight = usable.reduce((sum, s) => sum + s.weight, 0);
  const factors: RankingFactor[] = specs.map((s) => ({
    key: s.key,
    label: FACTOR_META[s.key].label,
    value: s.value == null ? 0 : round(s.value),
    weight: s.value == null || totalWeight === 0 ? 0 : s.weight / totalWeight,
    raw: s.raw,
  }));
  const score =
    totalWeight === 0
      ? 50
      : usable.reduce((sum, s) => sum + (s.value as number) * (s.weight / totalWeight), 0);
  return { score, factors, dropped: specs.filter((s) => s.value == null).map((s) => s.key) };
}

/** Min-max range over whichever teams have a value for a field. */
function rangeOf(
  teams: TeamRankingInput[],
  pick: (t: TeamRankingInput) => number | null | undefined,
): { min: number; max: number } | null {
  const values = teams.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
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
// Before week 1
// ---------------------------------------------------------------------------

/** Shared shell for the two pre-season modes. */
function preSeasonResult(
  mode: Exclude<RankingMode, "IN_SEASON">,
  weightTable: Record<string, number>,
  rowsIn: {
    input: TeamRankingInput;
    score: number;
    factors: RankingFactor[];
    dropped: FactorKey[];
    headlineNumber: number | null;
  }[],
  prevRank: Map<string, number>,
  leadNote: string,
): PowerRankingsResult {
  const notes = [leadNote];

  /*
   * A category is only reported as dropped when it is missing for EVERY team —
   * that is the case a reader needs explained. A single team missing one input
   * is visible in that team's own factor breakdown.
   */
  const droppedForAll = (Object.keys(weightTable) as FactorKey[]).filter((key) =>
    rowsIn.every((r) => r.dropped.includes(key)),
  );
  if (droppedForAll.length > 0) {
    notes.push(
      `${droppedForAll.map((k) => FACTOR_META[k].label).join(", ")} could not be measured from the recorded data, so ${droppedForAll.length === 1 ? "its weight was" : "their weights were"} redistributed across the remaining categories rather than scored as zero. The percentages below are the ones actually used.`,
    );
  }

  const rows = rowsIn
    .map((r) => ({
      fantasyTeamId: r.input.fantasyTeamId,
      managerId: r.input.managerId,
      managerName: r.input.managerName,
      teamName: r.input.teamName,
      score: round(r.score),
      weightedPointsPerGame: r.headlineNumber == null ? null : round(r.headlineNumber),
      allPlayWins: 0,
      allPlayLosses: 0,
      allPlayTies: 0,
      allPlayPct: 0,
      expectedWins: null,
      actualWins: 0,
      luck: null,
      lineupEfficiency: null,
      factors: r.factors,
    }))
    .sort((a, b) => b.score - a.score || a.managerName.localeCompare(b.managerName));

  // The published weights are the RESCALED ones, taken from the first team that
  // has a value for each category, so the table adds to 100%.
  const publishedWeight = (key: FactorKey): number => {
    for (const r of rowsIn) {
      const f = r.factors.find((x) => x.key === key);
      if (f && f.weight > 0) return f.weight;
    }
    return 0;
  };

  return {
    mode,
    throughWeek: 0,
    weeksCounted: 0,
    notes,
    weights: (Object.keys(weightTable) as FactorKey[])
      .map((key) => ({
        key,
        label: FACTOR_META[key].label,
        description: FACTOR_META[key].description,
        weight: publishedWeight(key),
      }))
      .filter((w) => w.weight > 0)
      .sort((a, b) => b.weight - a.weight),
    rows: rows.map((r, i) => ({
      ...r,
      rank: i + 1,
      previousRank: prevRank.get(r.fantasyTeamId) ?? null,
    })),
  };
}

/**
 * BEFORE THE DRAFT. No roster exists, so nothing about the coming season can be
 * ranked; what can be is the manager. Draft capital is deliberately absent —
 * there are no picks.
 */
function baselineRankings(
  teams: TeamRankingInput[],
  prevRank: Map<string, number>,
): PowerRankingsResult {
  const rScoring = rangeOf(teams, (t) => t.historicalPointsPerGame);
  const rSd = rangeOf(teams, (t) => t.historicalStdDev);
  const rAllPlay = rangeOf(teams, (t) => t.managerAllPlayRate);
  const rKeeper = rangeOf(teams, (t) => t.keeperValue);

  const rowsIn = teams.map((t) => {
    const specs: FactorSpec[] = [
      {
        key: "historicalScoring",
        weight: MANAGER_BASELINE_WEIGHTS.historicalScoring,
        value:
          t.historicalPointsPerGame == null || !rScoring
            ? null
            : normalize(t.historicalPointsPerGame, rScoring.min, rScoring.max),
        raw:
          t.historicalPointsPerGame == null
            ? "no prior seasons on record"
            : `${round(t.historicalPointsPerGame)} pts/gm across previous seasons`,
      },
      {
        key: "managerStrength",
        weight: MANAGER_BASELINE_WEIGHTS.managerStrength,
        value:
          t.managerAllPlayRate == null || !rAllPlay
            ? null
            : normalize(t.managerAllPlayRate, rAllPlay.min, rAllPlay.max),
        raw:
          t.managerAllPlayRate == null
            ? "no prior seasons on record"
            : `${(t.managerAllPlayRate * 100).toFixed(1)}% career all-play`,
      },
      {
        key: "historicalConsistency",
        weight: MANAGER_BASELINE_WEIGHTS.historicalConsistency,
        value:
          t.historicalStdDev == null || !rSd
            ? null
            : 100 - normalize(t.historicalStdDev, rSd.min, rSd.max),
        raw:
          t.historicalStdDev == null
            ? "no prior seasons on record"
            : `±${round(t.historicalStdDev)} points week to week`,
      },
      {
        key: "keeperValue",
        weight: MANAGER_BASELINE_WEIGHTS.keeperValue,
        value:
          t.keeperValue == null || !rKeeper ? null : normalize(t.keeperValue, rKeeper.min, rKeeper.max),
        raw: t.keeperValue == null ? "no keepers declared" : `${round(t.keeperValue)} points kept`,
      },
    ];
    const { score, factors, dropped } = blend(specs);
    return { input: t, score, factors, dropped, headlineNumber: t.historicalPointsPerGame ?? null };
  });

  return preSeasonResult(
    "MANAGER_BASELINE",
    MANAGER_BASELINE_WEIGHTS,
    rowsIn,
    prevRank,
    "The draft has not happened, so there are no rosters to rank. These are MANAGER BASELINE rankings: what each manager has done across previous seasons, with schedule luck removed. They say nothing about this year's team, because this year's team does not exist yet. They become Preseason Power Rankings the moment the draft board is in, and live rankings once week 1 is final.",
  );
}

/**
 * AFTER THE DRAFT, BEFORE WEEK 1. Now there is a roster, so the roster is what
 * gets ranked. Starter quality is measured from what the drafted players have
 * actually produced rather than from where they were taken — using pick
 * position would make this a restatement of the draft order.
 */
function preseasonRankings(
  teams: TeamRankingInput[],
  prevRank: Map<string, number>,
): PowerRankingsResult {
  const rDraft = rangeOf(teams, (t) => t.draftCapital);
  const rStarter = rangeOf(teams, (t) => t.starterQuality);
  const rBench = rangeOf(teams, (t) => t.benchQuality);
  const rBalance = rangeOf(teams, (t) => t.positionalBalance);
  const rDepth = rangeOf(teams, (t) => t.rosterDepth);
  const rProjection = rangeOf(teams, (t) => t.projectedPoints);

  const rowsIn = teams.map((t) => {
    const specs: FactorSpec[] = [
      {
        key: "draftCapital",
        weight: PRESEASON_WEIGHTS.draftCapital,
        value:
          t.draftCapital == null || !rDraft ? null : normalize(t.draftCapital, rDraft.min, rDraft.max),
        raw: t.draftCapital == null ? "no draft picks on record" : `${round(t.draftCapital)} capital`,
      },
      {
        key: "starterQuality",
        weight: PRESEASON_WEIGHTS.starterQuality,
        value:
          t.starterQuality == null || !rStarter
            ? null
            : normalize(t.starterQuality, rStarter.min, rStarter.max),
        raw:
          t.starterQuality == null
            ? "no prior production on record for the drafted starters"
            : `${round(t.starterQuality)} pts/gm from projected starters`,
      },
      {
        key: "projection",
        weight: PRESEASON_WEIGHTS.projection,
        value:
          t.projectedPoints == null || !rProjection
            ? null
            : normalize(t.projectedPoints, rProjection.min, rProjection.max),
        raw:
          t.projectedPoints == null
            ? "no published preseason projections available"
            : `${round(t.projectedPoints)} projected points`,
      },
      {
        key: "benchDepth",
        weight: PRESEASON_WEIGHTS.benchDepth,
        value:
          t.benchQuality == null || !rBench ? null : normalize(t.benchQuality, rBench.min, rBench.max),
        raw:
          t.benchQuality == null
            ? "no prior production on record for the bench"
            : `${round(t.benchQuality)} pts/gm on the bench`,
      },
      {
        key: "positionalBalance",
        weight: PRESEASON_WEIGHTS.positionalBalance,
        value:
          t.positionalBalance == null || !rBalance
            ? null
            : normalize(t.positionalBalance, rBalance.min, rBalance.max),
        raw:
          t.positionalBalance == null
            ? "no roster positions on record"
            : `${(t.positionalBalance * 100).toFixed(0)}% of required slots covered with backup`,
      },
      {
        key: "rosterDepth",
        weight: PRESEASON_WEIGHTS.rosterDepth,
        value: t.rosterDepth == null || !rDepth ? null : normalize(t.rosterDepth, rDepth.min, rDepth.max),
        raw: t.rosterDepth == null ? "no roster on record" : `${t.rosterDepth} players beyond the starters`,
      },
    ];
    const { score, factors, dropped } = blend(specs);
    return { input: t, score, factors, dropped, headlineNumber: t.starterQuality ?? null };
  });

  return preSeasonResult(
    "PRESEASON",
    PRESEASON_WEIGHTS,
    rowsIn,
    prevRank,
    "The draft is done but no week has been played, so these are PRESEASON POWER RANKINGS of the drafted rosters: draft capital, the production history of the players taken, bench cover and positional balance. No result from a previous season is scored here — this is about the team that was just assembled. They switch to live rankings automatically once week 1 is final.",
  );
}

/**
 * Draft capital for a team: each pick is worth more the earlier it was made,
 * on a decay curve rather than a straight line, because the gap between picks
 * 1 and 10 is far larger than between 100 and 110.
 */
export function draftCapitalScore(overallPickNumbers: number[]): number {
  return overallPickNumbers.reduce((sum, pick) => sum + 100 / Math.sqrt(Math.max(1, pick)), 0);
}
