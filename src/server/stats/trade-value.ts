/**
 * TRADE VALUATION — what a trade was actually worth, position by position.
 *
 * ── The problem with raw points ────────────────────────────────────────────
 * The Tribunal used to compare the two sides on total rest-of-season points.
 * That makes a quarterback look like a steal in every trade he appears in: a
 * mid-range QB outscores a top-five tight end by fifty points and is worth far
 * less, because the next QB off the waiver wire also outscores that tight end.
 * Points are not comparable across positions, so they cannot settle a trade.
 *
 * ── What is compared instead ───────────────────────────────────────────────
 * Every acquired player is converted into ONE number that means the same thing
 * at every position: how much better than freely-available they were, for as
 * long as they were available, weighted by how hard that position is to
 * replace.
 *
 *   Replacement level   The points per game of the last player at that
 *                       position who would still be starting somewhere in the
 *                       league. With ten teams starting two running backs, the
 *                       20th-best RB is what a manager could have had for
 *                       nothing, so only production above that line counts.
 *
 *   Points above        (points per game − replacement) × games available
 *   replacement         after the trade. A player who was hurt in week 10
 *                       banks what he produced and no more, so availability
 *                       and injury are handled by counting, not by estimating.
 *
 *   Positional          How steep the drop-off is at that position: the top
 *   scarcity            starters' average divided by replacement level. A
 *                       position where the good ones are far ahead of the
 *                       replacement is worth more per point above it.
 *
 *   Playoff weeks       Production in the postseason weeks is counted a second
 *                       time at a reduced weight. Winning a title is the point,
 *                       and a player who faded in December did less for you
 *                       than the season total suggests.
 *
 *   Consolidation       Turning two roster spots into one better player frees a
 *                       spot; a small credit reflects that, capped so it can
 *                       never decide a verdict on its own.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 * Draft picks and FAAB have no market price on record, so they are NOT given
 * an invented value. A trade containing them is reported with the pick or the
 * money named, its confidence lowered, and the missing input stated.
 *
 * Everything here is pure and deterministic.
 */

/** How much a postseason point is worth on top of its regular-season value. */
const PLAYOFF_BONUS_WEIGHT = 0.5;

/** Ceiling on the consolidation credit, in normalised value units. */
const MAX_CONSOLIDATION_CREDIT = 8;

/** Fewest post-trade games before a player's contribution is confidently read. */
const CONFIDENT_GAMES = 4;

/** Starting slots per position in a standard lineup, used for replacement level. */
export const STARTING_SLOTS: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  K: 1,
  DEF: 1,
};

/** A flex slot is filled from these, so their replacement line sits deeper. */
const FLEX_POSITIONS = ["RB", "WR", "TE"];
const FLEX_SLOTS = 1;

export type Lopsidedness =
  | "HIGHWAY_ROBBERY"
  | "FLEECED"
  | "CLEAR_WINNER"
  | "SLIGHT_EDGE"
  | "EVEN_DEAL";

export const LOPSIDEDNESS_LABEL: Record<Lopsidedness, string> = {
  HIGHWAY_ROBBERY: "Highway Robbery",
  FLEECED: "Fleeced",
  CLEAR_WINNER: "Clear Winner",
  SLIGHT_EDGE: "Slight Edge",
  EVEN_DEAL: "Even Deal",
};

export type TradeConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

/** One player's production after the trade, as recorded. */
export interface PlayerWindow {
  playerId: string;
  name: string;
  position: string;
  /** Weeks with a recorded score after the trade. */
  gamesPlayed: number;
  /** Total points scored in those weeks. */
  points: number;
  /** Points scored in postseason weeks only. */
  playoffPoints: number;
  /** Postseason weeks with a recorded score. */
  playoffGames: number;
  /** Weeks that existed after the trade — the denominator for availability. */
  weeksRemaining: number;
}

/** Replacement level and scarcity for one position in one season. */
export interface PositionContext {
  position: string;
  /** Points per game of the last startable player at this position. */
  replacementPpg: number;
  /** Top starters' average divided by replacement; 1 when unavailable. */
  scarcity: number;
  /** How many players at this position had recorded scores in the window. */
  sampleSize: number;
}

export interface ValuedPlayer {
  playerId: string;
  name: string;
  position: string;
  pointsPerGame: number | null;
  /** Points per game above the replacement line at this position. */
  ppgAboveReplacement: number | null;
  /** Total points above replacement across the games actually played. */
  pointsAboveReplacement: number | null;
  /** 0-100 among players at the same position in the same window. */
  positionalPercentile: number | null;
  /** Games played divided by weeks remaining after the trade. */
  availability: number | null;
  /** Share of played weeks in which they outscored replacement. */
  starterUsability: number | null;
  /** The single normalised figure this player contributes to their side. */
  value: number;
  /** Why a figure is missing, when it is. */
  note: string | null;
}

export interface ValuedSide {
  managerId: string;
  managerName: string;
  players: ValuedPlayer[];
  /** Assets with no market price on record: picks and FAAB. */
  unpricedAssets: string[];
  /** Sum of player values plus any consolidation credit. */
  value: number;
  consolidationCredit: number;
}

export interface TradeValuation {
  sides: ValuedSide[];
  /** |A − B| in normalised value units; null when it cannot be computed. */
  differential: number | null;
  /** Differential as a share of the average side's value. */
  relativeDifferential: number | null;
  lopsidedness: Lopsidedness | null;
  /** The manager who came out ahead; null on an even deal or when unknown. */
  winnerManagerId: string | null;
  confidence: TradeConfidence;
  /** Inputs the valuation could not obtain, named for the reader. */
  missingInputs: string[];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Builds replacement level and scarcity for one position from every player at
 * that position who scored in the window.
 *
 * `teamCount` sets how deep the startable pool goes. Flex-eligible positions
 * get a share of the flex slots on top of their own, because a manager can and
 * does start a third running back.
 */
export function buildPositionContext(
  position: string,
  playerPpgs: number[],
  teamCount: number,
): PositionContext {
  const sorted = [...playerPpgs].sort((a, b) => b - a);
  if (sorted.length === 0) {
    return { position, replacementPpg: 0, scarcity: 1, sampleSize: 0 };
  }

  const own = STARTING_SLOTS[position] ?? 1;
  const flexShare = FLEX_POSITIONS.includes(position) ? FLEX_SLOTS / FLEX_POSITIONS.length : 0;
  const startable = Math.max(1, Math.round(teamCount * (own + flexShare)));

  // The replacement is the first player OUTSIDE the startable pool. If the
  // league has fewer players than slots, the worst one on record stands in.
  const replacementIndex = Math.min(startable, sorted.length - 1);
  const replacementPpg = sorted[replacementIndex];

  const starters = sorted.slice(0, Math.min(startable, sorted.length));
  const starterMean = mean(starters);
  const scarcity = replacementPpg > 0.5 ? starterMean / replacementPpg : 1;

  return {
    position,
    replacementPpg,
    // Kept in a sane band: a position where replacement is near zero would
    // otherwise produce an unbounded multiplier off one weak week.
    scarcity: Math.max(1, Math.min(2.5, scarcity)),
    sampleSize: sorted.length,
  };
}

/** Converts one acquired player into a single position-neutral figure. */
export function valuePlayer(
  window: PlayerWindow,
  context: PositionContext | undefined,
  percentile: number | null,
): ValuedPlayer {
  const base = {
    playerId: window.playerId,
    name: window.name,
    position: window.position,
  };

  if (window.gamesPlayed === 0) {
    return {
      ...base,
      pointsPerGame: null,
      ppgAboveReplacement: null,
      pointsAboveReplacement: null,
      positionalPercentile: percentile,
      availability: window.weeksRemaining > 0 ? 0 : null,
      starterUsability: null,
      value: 0,
      note: "did not record a game after the trade",
    };
  }

  if (!context || context.sampleSize < 3) {
    return {
      ...base,
      pointsPerGame: Number((window.points / window.gamesPlayed).toFixed(1)),
      ppgAboveReplacement: null,
      pointsAboveReplacement: null,
      positionalPercentile: percentile,
      availability:
        window.weeksRemaining > 0
          ? Number((window.gamesPlayed / window.weeksRemaining).toFixed(2))
          : null,
      starterUsability: null,
      value: 0,
      note: `too few ${window.position}s on record to establish a replacement level`,
    };
  }

  const ppg = window.points / window.gamesPlayed;
  const ppgAbove = ppg - context.replacementPpg;
  const par = ppgAbove * window.gamesPlayed;

  const playoffPpg = window.playoffGames > 0 ? window.playoffPoints / window.playoffGames : 0;
  const playoffPar =
    window.playoffGames > 0 ? (playoffPpg - context.replacementPpg) * window.playoffGames : 0;

  /*
   * Value is floored at zero. A player who scores below replacement does not
   * COST his manager points — he gets benched or dropped and the slot is
   * refilled from waivers, which is what replacement level means. Letting the
   * figure go negative made a trade where both sides got busts read as a
   * hundred-point fleecing, because one bust was worse than the other. The
   * unfloored figure is still reported as pointsAboveReplacement so a reader
   * can see exactly how badly it went.
   */
  const value =
    Math.max(0, par) * context.scarcity +
    Math.max(0, playoffPar) * PLAYOFF_BONUS_WEIGHT * context.scarcity;

  return {
    ...base,
    pointsPerGame: Number(ppg.toFixed(1)),
    ppgAboveReplacement: Number(ppgAbove.toFixed(1)),
    pointsAboveReplacement: Number(par.toFixed(1)),
    positionalPercentile: percentile,
    availability:
      window.weeksRemaining > 0
        ? Number((window.gamesPlayed / window.weeksRemaining).toFixed(2))
        : null,
    // A player is "usable" in a week when they clear the replacement line; over
    // a whole window the closest honest reading is whether their average did.
    starterUsability: ppgAbove > 0 ? 1 : 0,
    value: Number(value.toFixed(1)),
    note: null,
  };
}

/**
 * Grades how one-sided a trade was.
 *
 * BOTH a relative and an absolute test have to pass. Relative alone would call
 * a trade of two nobodies "Highway Robbery" because one produced twice as much
 * as the other; absolute alone would let a blockbuster where both sides did
 * well read as lopsided.
 */
export function gradeLopsidedness(
  differential: number,
  averageSideValue: number,
): Lopsidedness {
  const relative = averageSideValue > 1 ? differential / averageSideValue : differential > 20 ? 2 : 0;
  if (relative >= 1.0 && differential >= 60) return "HIGHWAY_ROBBERY";
  if (relative >= 0.6 && differential >= 35) return "FLEECED";
  if (relative >= 0.3 && differential >= 18) return "CLEAR_WINNER";
  if (relative >= 0.12 && differential >= 8) return "SLIGHT_EDGE";
  return "EVEN_DEAL";
}

/** Combines valued sides into a verdict. */
export function valuateTrade(
  sides: ValuedSide[],
  opts: { missingInputs: string[]; playerCount: number; confidentPlayers: number },
): TradeValuation {
  const confidence: TradeConfidence =
    opts.playerCount === 0
      ? "NONE"
      : opts.confidentPlayers === opts.playerCount && opts.missingInputs.length === 0
        ? "HIGH"
        : opts.confidentPlayers >= Math.ceil(opts.playerCount / 2)
          ? "MEDIUM"
          : "LOW";

  if (sides.length !== 2 || confidence === "NONE") {
    return {
      sides,
      differential: null,
      relativeDifferential: null,
      lopsidedness: null,
      winnerManagerId: null,
      confidence,
      missingInputs: opts.missingInputs,
    };
  }

  const [a, b] = sides;
  const differential = Number(Math.abs(a.value - b.value).toFixed(1));
  const averageSideValue = (Math.abs(a.value) + Math.abs(b.value)) / 2;
  const relativeDifferential =
    averageSideValue > 1 ? Number((differential / averageSideValue).toFixed(2)) : null;
  const lopsidedness = gradeLopsidedness(differential, averageSideValue);

  return {
    sides,
    differential,
    relativeDifferential,
    lopsidedness,
    winnerManagerId:
      lopsidedness === "EVEN_DEAL" ? null : a.value > b.value ? a.managerId : b.managerId,
    confidence,
    missingInputs: opts.missingInputs,
  };
}

/** Credit for turning several roster spots into fewer, better ones. */
export function consolidationCredit(playersIn: number, playersOut: number): number {
  const freed = playersOut - playersIn;
  if (freed <= 0) return 0;
  return Math.min(MAX_CONSOLIDATION_CREDIT, freed * 4);
}

export const TRADE_VALUE_CONSTANTS = {
  PLAYOFF_BONUS_WEIGHT,
  MAX_CONSOLIDATION_CREDIT,
  CONFIDENT_GAMES,
};
