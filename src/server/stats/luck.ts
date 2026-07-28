import type { GameBracket } from "./types";

/**
 * The Luck Score: how much of a manager's record the schedule handed them,
 * on a fixed 0-100 scale where 50 is neutral.
 *
 * ── What it is ────────────────────────────────────────────────────────────
 * Fantasy football decides two things independently: how many points you
 * score, and who you happen to play that week. The first is skill. The second
 * is a draw. The Luck Score measures only the second — it asks whether a
 * manager's results are better or worse than their scoring deserved, and it is
 * computed entirely from recorded scores. Nothing here is a judgement call, no
 * model generates it, and the same input always produces the same number.
 *
 * ── The five components ───────────────────────────────────────────────────
 *  Wins vs expected (40%)   Actual win rate minus all-play win rate: what the
 *                           record would be if you played every team every
 *                           week. Beating it means the schedule cooperated.
 *  Opponent scoring (20%)   How much the teams you faced actually put up,
 *                           against the league average. Drawing quiet weeks is
 *                           the purest form of luck there is.
 *  Close games (15%)        Record in games decided by under five points.
 *                           Coin flips should land near .500 over time.
 *  Schedule strength (15%)  The season-long quality of the opponents drawn,
 *                           measured by their own all-play rate — distinct
 *                           from the component above, which is about the weeks
 *                           you caught them in rather than how good they were.
 *  Postseason draw (10%)    In championship-bracket games only: did opponents
 *                           beat their own season average against you?
 *
 * Each component is expressed as a deviation in roughly [-1, +1], positive
 * meaning lucky. A component with too little data to mean anything is dropped
 * and the remaining weights are renormalised, so a manager with no postseason
 * games is not scored as though their postseason draw were neutral.
 *
 * ── Reading the number ────────────────────────────────────────────────────
 * 50 is neutral. Above 50 the record flatters the scoring; below 50 it
 * understates it. It is NOT a rating: a very lucky team can be terrible and a
 * very unlucky one excellent. It says nothing about how good a manager is.
 *
 * ── When it is not shown ──────────────────────────────────────────────────
 * Under four games there is no signal, so the score is null and the caller is
 * told the reason. A season that has not started reports INSUFFICIENT, never
 * "neutral" — "we don't know yet" and "the luck evened out" are different
 * statements and the site must not confuse them.
 */

const CLOSE_GAME_MARGIN = 5;

/** Fewest games before a score is produced at all. */
const MIN_GAMES = 4;
/** Fewest close games before that component means anything. */
const MIN_CLOSE_GAMES = 4;
/** Fewest championship-bracket games before the postseason component counts. */
const MIN_POSTSEASON_GAMES = 2;

/** Full weight is only reached once a manager has this many games. */
const HIGH_CONFIDENCE_GAMES = 26;
const MEDIUM_CONFIDENCE_GAMES = 13;

/**
 * Denominators that turn each raw difference into a roughly [-1, 1] deviation.
 * They are the point at which a component is considered maximally lucky, chosen
 * so that a full swing is genuinely extreme rather than merely uncommon.
 */
const SCALE = {
  /** 30 percentage points of win rate above all-play. */
  winsVsExpected: 0.3,
  /** Opponents scoring 12% below league average. */
  opponentScoringPct: 0.12,
  /** A perfect or winless close-game record. */
  closeGames: 0.5,
  /** Opponents 10 percentage points of all-play weaker than average. */
  scheduleStrength: 0.1,
  /** Postseason opponents 12% below their own season average. */
  postseasonDrawPct: 0.12,
} as const;

const WEIGHTS = {
  winsVsExpected: 0.4,
  opponentScoring: 0.2,
  closeGames: 0.15,
  scheduleStrength: 0.15,
  postseasonDraw: 0.1,
} as const;

export type LuckConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export interface LuckGame {
  season: number;
  week: number;
  isPlayoff: boolean;
  bracket?: GameBracket | null;
  pointsFor: number;
  pointsAgainst: number;
  result: "W" | "L" | "T";
  opponentId: string;
}

/** One team's score in one week, for the whole league. */
export interface LeagueWeekScore {
  season: number;
  week: number;
  managerId: string;
  points: number;
  isPlayoff: boolean;
}

export interface LuckComponent {
  key: keyof typeof WEIGHTS;
  label: string;
  /** Share of the score this component carried, after renormalisation. 0 if unavailable. */
  weight: number;
  /** -1 (as unlucky as the scale goes) to +1 (as lucky). Null when unavailable. */
  deviation: number | null;
  /** Plain-language value, e.g. "5.2 wins vs 7.1 expected". */
  detail: string;
  available: boolean;
}

export interface LuckScore {
  /** 0-100, 50 neutral. Null when there is not enough played football to say. */
  score: number | null;
  label: string;
  confidence: LuckConfidence;
  gamesConsidered: number;
  components: LuckComponent[];
  /** Why the score is null or low-confidence; null when it is fully supported. */
  caveat: string | null;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function luckLabel(score: number): string {
  if (score >= 80) return "Very lucky";
  if (score >= 65) return "Lucky";
  if (score >= 56) return "Slightly lucky";
  if (score > 44) return "Neutral";
  if (score > 35) return "Slightly unlucky";
  if (score > 20) return "Unlucky";
  return "Very unlucky";
}

/**
 * All-play win rate per manager, from the regular season only. All-play in a
 * postseason week is meaningless — most of the league is no longer playing for
 * anything and several teams have no opponent at all.
 */
function allPlayRates(league: LeagueWeekScore[]): Map<string, number> {
  const byWeek = new Map<string, LeagueWeekScore[]>();
  for (const row of league) {
    if (row.isPlayoff) continue;
    const key = `${row.season}-${row.week}`;
    const list = byWeek.get(key) ?? [];
    list.push(row);
    byWeek.set(key, list);
  }

  const tally = new Map<string, { w: number; l: number; t: number }>();
  for (const rows of byWeek.values()) {
    for (const a of rows) {
      const rec = tally.get(a.managerId) ?? { w: 0, l: 0, t: 0 };
      for (const b of rows) {
        if (b.managerId === a.managerId) continue;
        if (a.points > b.points) rec.w += 1;
        else if (a.points < b.points) rec.l += 1;
        else rec.t += 1;
      }
      tally.set(a.managerId, rec);
    }
  }

  const rates = new Map<string, number>();
  for (const [managerId, rec] of tally) {
    const games = rec.w + rec.l + rec.t;
    if (games > 0) rates.set(managerId, (rec.w + 0.5 * rec.t) / games);
  }
  return rates;
}

/** Regular-season points per game per manager. */
function seasonAverages(league: LeagueWeekScore[]): Map<string, number> {
  const byManager = new Map<string, number[]>();
  for (const row of league) {
    if (row.isPlayoff) continue;
    const list = byManager.get(row.managerId) ?? [];
    list.push(row.points);
    byManager.set(row.managerId, list);
  }
  const out = new Map<string, number>();
  for (const [managerId, points] of byManager) out.set(managerId, mean(points));
  return out;
}

/**
 * Computes one manager's Luck Score.
 *
 * `games` is that manager's game log; `league` is every team's weekly score
 * across the same span, which is what the all-play and opponent-quality
 * components are measured against. Pass a single season's worth of both for a
 * current-season score, or a whole career for a career score — the maths does
 * not change.
 */
export function computeLuckScore(
  managerId: string,
  games: LuckGame[],
  league: LeagueWeekScore[],
): LuckScore {
  const regular = games.filter((g) => !g.isPlayoff);
  const gamesConsidered = regular.length;

  const emptyComponents = (): LuckComponent[] => [
    { key: "winsVsExpected", label: "Wins vs expected", weight: 0, deviation: null, detail: "—", available: false },
    { key: "opponentScoring", label: "Opponent scoring", weight: 0, deviation: null, detail: "—", available: false },
    { key: "closeGames", label: "Close games", weight: 0, deviation: null, detail: "—", available: false },
    { key: "scheduleStrength", label: "Schedule strength", weight: 0, deviation: null, detail: "—", available: false },
    { key: "postseasonDraw", label: "Postseason draw", weight: 0, deviation: null, detail: "—", available: false },
  ];

  if (gamesConsidered < MIN_GAMES) {
    return {
      score: null,
      label: "Not enough games",
      confidence: "INSUFFICIENT",
      gamesConsidered,
      components: emptyComponents(),
      caveat:
        gamesConsidered === 0
          ? "No games played yet, so there is no luck to measure."
          : `Only ${gamesConsidered} game${gamesConsidered === 1 ? "" : "s"} played; at least ${MIN_GAMES} are needed before the number means anything.`,
    };
  }

  const allPlay = allPlayRates(league);
  const averages = seasonAverages(league);
  const leagueAvgPoints = mean([...averages.values()]);
  const leagueAvgAllPlay = mean([...allPlay.values()]);

  const components: LuckComponent[] = [];

  // ── 1. Wins vs all-play expectation ─────────────────────────────────────
  const wins = regular.filter((g) => g.result === "W").length;
  const ties = regular.filter((g) => g.result === "T").length;
  const actualRate = (wins + 0.5 * ties) / gamesConsidered;
  const expectedRate = allPlay.get(managerId);
  if (expectedRate == null) {
    components.push({
      key: "winsVsExpected",
      label: "Wins vs expected",
      weight: 0,
      deviation: null,
      detail: "No league-wide weekly scores to compare against",
      available: false,
    });
  } else {
    const expectedWins = expectedRate * gamesConsidered;
    components.push({
      key: "winsVsExpected",
      label: "Wins vs expected",
      weight: WEIGHTS.winsVsExpected,
      deviation: clamp((actualRate - expectedRate) / SCALE.winsVsExpected, -1, 1),
      detail: `${(wins + 0.5 * ties).toFixed(1)} wins, ${expectedWins.toFixed(1)} expected from scoring alone`,
      available: true,
    });
  }

  // ── 2. What opponents actually scored ───────────────────────────────────
  const oppPoints = mean(regular.map((g) => g.pointsAgainst));
  if (leagueAvgPoints > 0) {
    const pct = (leagueAvgPoints - oppPoints) / leagueAvgPoints;
    components.push({
      key: "opponentScoring",
      label: "Opponent scoring",
      weight: WEIGHTS.opponentScoring,
      deviation: clamp(pct / SCALE.opponentScoringPct, -1, 1),
      detail: `Opponents averaged ${oppPoints.toFixed(1)} against a league average of ${leagueAvgPoints.toFixed(1)}`,
      available: true,
    });
  } else {
    components.push({
      key: "opponentScoring",
      label: "Opponent scoring",
      weight: 0,
      deviation: null,
      detail: "No league scoring average available",
      available: false,
    });
  }

  // ── 3. Close games ──────────────────────────────────────────────────────
  const close = regular.filter(
    (g) => Math.abs(g.pointsFor - g.pointsAgainst) < CLOSE_GAME_MARGIN && g.result !== "T",
  );
  if (close.length >= MIN_CLOSE_GAMES) {
    const closeWins = close.filter((g) => g.result === "W").length;
    const rate = closeWins / close.length;
    components.push({
      key: "closeGames",
      label: "Close games",
      weight: WEIGHTS.closeGames,
      deviation: clamp((rate - 0.5) / SCALE.closeGames, -1, 1),
      detail: `${closeWins}-${close.length - closeWins} in games decided by under ${CLOSE_GAME_MARGIN} points`,
      available: true,
    });
  } else {
    components.push({
      key: "closeGames",
      label: "Close games",
      weight: 0,
      deviation: null,
      detail: `Only ${close.length} game${close.length === 1 ? "" : "s"} decided by under ${CLOSE_GAME_MARGIN} points — too few to read`,
      available: false,
    });
  }

  // ── 4. Strength of the opponents drawn ──────────────────────────────────
  const oppRates = regular
    .map((g) => allPlay.get(g.opponentId))
    .filter((r): r is number => r != null);
  if (oppRates.length >= MIN_GAMES && leagueAvgAllPlay > 0) {
    const drawn = mean(oppRates);
    components.push({
      key: "scheduleStrength",
      label: "Schedule strength",
      weight: WEIGHTS.scheduleStrength,
      deviation: clamp((leagueAvgAllPlay - drawn) / SCALE.scheduleStrength, -1, 1),
      detail: `Opponents drawn were ${(drawn * 100).toFixed(0)}% all-play teams against a league average of ${(leagueAvgAllPlay * 100).toFixed(0)}%`,
      available: true,
    });
  } else {
    components.push({
      key: "scheduleStrength",
      label: "Schedule strength",
      weight: 0,
      deviation: null,
      detail: "Not enough opponent history to rate the schedule",
      available: false,
    });
  }

  // ── 5. Postseason draw ──────────────────────────────────────────────────
  const titleGames = games.filter((g) => g.isPlayoff && g.bracket === "WINNERS");
  const withBaseline = titleGames
    .map((g) => ({ actual: g.pointsAgainst, baseline: averages.get(g.opponentId) }))
    .filter((x): x is { actual: number; baseline: number } => x.baseline != null && x.baseline > 0);
  if (withBaseline.length >= MIN_POSTSEASON_GAMES) {
    const pct = mean(withBaseline.map((x) => (x.baseline - x.actual) / x.baseline));
    components.push({
      key: "postseasonDraw",
      label: "Postseason draw",
      weight: WEIGHTS.postseasonDraw,
      deviation: clamp(pct / SCALE.postseasonDrawPct, -1, 1),
      detail: `Championship-bracket opponents scored ${Math.abs(pct * 100).toFixed(0)}% ${pct >= 0 ? "below" : "above"} their season average`,
      available: true,
    });
  } else {
    components.push({
      key: "postseasonDraw",
      label: "Postseason draw",
      weight: 0,
      deviation: null,
      detail:
        titleGames.length === 0
          ? "No championship-bracket games played"
          : `Only ${titleGames.length} championship-bracket game${titleGames.length === 1 ? "" : "s"} — too few to read`,
      available: false,
    });
  }

  // ── Combine, renormalising over whatever was available ───────────────────
  const usable = components.filter((c) => c.available && c.deviation != null);
  const totalWeight = usable.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) {
    return {
      score: null,
      label: "Not enough data",
      confidence: "INSUFFICIENT",
      gamesConsidered,
      components,
      caveat: "None of the luck components could be measured from the recorded data.",
    };
  }
  for (const c of components) c.weight = c.available ? c.weight / totalWeight : 0;

  const deviation = usable.reduce(
    (sum, c) => sum + (c.deviation as number) * (c.weight as number),
    0,
  );
  const score = Math.round(clamp(50 + 50 * deviation, 0, 100));

  const confidence: LuckConfidence =
    gamesConsidered >= HIGH_CONFIDENCE_GAMES
      ? "HIGH"
      : gamesConsidered >= MEDIUM_CONFIDENCE_GAMES
        ? "MEDIUM"
        : "LOW";

  const missing = components.filter((c) => !c.available).map((c) => c.label);
  const caveats: string[] = [];
  if (confidence !== "HIGH") {
    caveats.push(
      `${gamesConsidered} games measured; ${HIGH_CONFIDENCE_GAMES} give a settled reading`,
    );
  }
  if (missing.length > 0) {
    caveats.push(
      `${missing.join(" and ")} could not be measured, so the remaining weights were rescaled`,
    );
  }

  return {
    score,
    label: luckLabel(score),
    confidence,
    gamesConsidered,
    components,
    caveat: caveats.length ? `${caveats.join(". ")}.` : null,
  };
}

/** The published weights, for the methodology panel. Sums to 1. */
export const LUCK_WEIGHTS = WEIGHTS;
export const LUCK_MIN_GAMES = MIN_GAMES;
export const LUCK_CLOSE_GAME_MARGIN = CLOSE_GAME_MARGIN;
