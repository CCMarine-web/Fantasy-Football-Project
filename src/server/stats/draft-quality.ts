/**
 * DRAFT QUALITY — grading a draft on the decisions made at the draft, not on
 * how the season happened to turn out.
 *
 * ── Why the old grade was wrong ────────────────────────────────────────────
 * The previous "original" grade was a near-constant B+/B, and the "revisited"
 * grade was derived purely from final standings — champion got an A+, last
 * place an F. That graded the season, not the draft. A manager who drafted
 * badly and then won the league through waivers scored an A+; a manager who
 * drafted superbly and lost four starters to injury scored an F.
 *
 * This model grades only what a manager controlled on draft day.
 *
 * ── Factors (each 0-100, normalised across the league that season) ─────────
 *
 *   Value vs ADP        26%  did picks beat their market price
 *   Starter quality     20%  strength of the projected starting lineup
 *   Roster construction 16%  a legal, balanced starting lineup with no holes
 *   Positional scarcity 12%  taking scarce positions before they dried up
 *   Bench upside        10%  useful depth rather than dead weight
 *   Draft capital used   8%  did the slot get converted into value
 *   Bye-week spread      4%  starters not stacked on one bye
 *   Risk concentration   4%  not betting the season on one team or one player
 *
 * ── When a factor cannot be measured ───────────────────────────────────────
 * Any factor with no data behind it is DROPPED and its weight redistributed
 * across the rest, and the result is flagged so the page can say so plainly. A
 * factor that scores every team 50 is not neutral — it is a quarter of the
 * grade decided by nothing, and it invites the writer to comment on data that
 * does not exist. Three factors can drop:
 *
 *   Value vs ADP        Historical ADP is not retrievable for this league's
 *                       ESPN era, and Sleeper does not publish per-season ADP
 *                       through the endpoints in use.
 *   Bye-week spread     NFL bye weeks are not stored per season.
 *   Risk concentration  Dropped when no team stacked more than
 *                       RISK_FREE_STACK players from one NFL team, because
 *                       below that there is no concentration to grade.
 *
 * Draft position within the draft itself is still used — where a player went
 * relative to the other 159 picks in the same room is real, observed
 * information, and does not need an outside market to be meaningful.
 *
 * Nothing here looks at the season that followed. The revisited grade does,
 * and lives separately.
 */

import { ordinal } from "@/lib/format";

/**
 * Players from one NFL team a draft can hold before it counts as a stack.
 *
 * A 16-round draft out of 32 NFL teams puts two or three players from the same
 * club on most rosters by accident. Grading that as "risk concentration" made
 * the report cards accuse managers of a strategy they had not chosen, so only
 * the excess above this line is measured, and when no team exceeds it the
 * factor is dropped entirely.
 */
export const RISK_FREE_STACK = 3;

export const DRAFT_WEIGHTS = {
  valueVsAdp: 0.26,
  starterQuality: 0.2,
  rosterConstruction: 0.16,
  positionalScarcity: 0.12,
  benchUpside: 0.1,
  capitalEfficiency: 0.08,
  byeWeekSpread: 0.04,
  riskConcentration: 0.04,
} as const;

export type DraftFactorKey = keyof typeof DRAFT_WEIGHTS;

export const DRAFT_FACTOR_META: Record<DraftFactorKey, { label: string; description: string }> = {
  valueVsAdp: {
    label: "Value vs ADP",
    description:
      "Whether picks beat their average draft position — the market price of each player at the time.",
  },
  starterQuality: {
    label: "Starter quality",
    description:
      "How the players filling the starting slots ranked at their own positions the season before the draft. Deliberately not measured by where they were taken — that would make the grade a restatement of the draft order.",
  },
  rosterConstruction: {
    label: "Roster construction",
    description:
      "A complete, balanced starting lineup — every required slot filled without over-stocking one position.",
  },
  positionalScarcity: {
    label: "Positional scarcity",
    description:
      "Securing thin positions before the run, and not spending early capital on replaceable ones.",
  },
  benchUpside: {
    label: "Bench upside",
    description:
      "Depth worth holding rather than filler — bench picks taken meaningfully before the end of the draft.",
  },
  capitalEfficiency: {
    label: "Draft capital used",
    description:
      "Starter quality obtained per unit of draft capital spent, where capital sums 100/√(pick number) across every pick a manager owned — so an early slot is worth more than a late one and the score rewards converting the slot rather than merely having it. The raw figure is that ratio; only its position within the league is graded.",
  },
  byeWeekSpread: {
    label: "Bye-week spread",
    description: "Starters spread across bye weeks instead of stacked into one unplayable Sunday.",
  },
  riskConcentration: {
    label: "Risk concentration",
    description: `Whether a roster is stacked on a single NFL team beyond the ${RISK_FREE_STACK} players any draft picks up incidentally. Below that line there is nothing to grade and the factor is dropped rather than scored.`,
  },
};


export interface DraftPickInput {
  /** Overall pick number in this draft, 1-based. */
  overallPickNumber: number;
  round: number;
  isKeeper: boolean;
  position: string | null;
  nflTeam: string | null;
  /** Average draft position at the time, if known. Null disables the ADP factor. */
  adp?: number | null;
  /** NFL bye week for this player's team that season, if known. */
  byeWeek?: number | null;
  /**
   * How this player ranked at his own position on the season BEFORE the draft,
   * as a percentile: 100 is the best player at the position, 0 the worst.
   *
   * This is the measure of starter quality, deliberately in place of where the
   * player was taken. Draft position records what the room believed on the
   * night, so grading a draft by it makes the grade a restatement of the draft
   * order — a manager with the first pick is rewarded for having the first
   * pick. A player's positional standing going into the draft is something a
   * room could actually know and be right or wrong about.
   *
   * Null for a rookie, or for anyone with no prior season on record.
   */
  priorPositionalPercentile?: number | null;
}

export interface TeamDraftInput {
  fantasyTeamId: string;
  managerId: string;
  managerName: string;
  picks: DraftPickInput[];
}

export interface DraftFactor {
  key: DraftFactorKey;
  label: string;
  value: number;
  weight: number;
  raw: string;
}

export interface TeamDraftGrade {
  fantasyTeamId: string;
  managerId: string;
  managerName: string;
  /** 0-100 composite of draft-day decisions only. */
  score: number;
  rank: number;
  factors: DraftFactor[];
  /** Standard fantasy starting lineup slots this draft could fill. */
  startersByPosition: Record<string, number>;
  pickCount: number;
  keeperCount: number;
}

export interface DraftQualityResult {
  teams: TeamDraftGrade[];
  /** False when no ADP was available and that factor was dropped. */
  adpAvailable: boolean;
  weights: { key: DraftFactorKey; label: string; description: string; weight: number }[];
  notes: string[];
}

/**
 * A standard starting lineup. Used to decide which picks count as starters and
 * whether the roster is actually playable.
 */
const STARTING_SLOTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 };
const FLEX_ELIGIBLE = new Set(["RB", "WR", "TE"]);
const FLEX_SLOTS = 1;
/** Total starting slots that must be filled: 8 fixed plus the flex. */
const REQUIRED_STARTERS = Object.values(STARTING_SLOTS).reduce((a, b) => a + b, 0) + FLEX_SLOTS;

/** Positions that are genuinely scarce, most to least. */
const SCARCITY_RANK: Record<string, number> = {
  TE: 1,
  QB: 0.75,
  RB: 0.7,
  WR: 0.4,
  DEF: 0.15,
  K: 0.1,
};

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 50;
  if (max - min < 1e-9) return 50;
  return ((value - min) / (max - min)) * 100;
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * Splits a team's picks into the starting lineup it could field and the bench,
 * filling required slots in draft order then the flex.
 */
function splitStarters(picks: DraftPickInput[]): {
  starters: DraftPickInput[];
  bench: DraftPickInput[];
  byPosition: Record<string, number>;
} {
  const remaining: Record<string, number> = { ...STARTING_SLOTS };
  let flex = FLEX_SLOTS;
  const starters: DraftPickInput[] = [];
  const bench: DraftPickInput[] = [];
  const byPosition: Record<string, number> = {};

  for (const pick of [...picks].sort((a, b) => a.overallPickNumber - b.overallPickNumber)) {
    const pos = pick.position ?? "UNK";
    byPosition[pos] = (byPosition[pos] ?? 0) + 1;
    if ((remaining[pos] ?? 0) > 0) {
      remaining[pos] -= 1;
      starters.push(pick);
    } else if (flex > 0 && FLEX_ELIGIBLE.has(pos)) {
      flex -= 1;
      starters.push(pick);
    } else {
      bench.push(pick);
    }
  }
  return { starters, bench, byPosition };
}

/**
 * Grades every team's draft in one season, relative to each other.
 *
 * Relative scoring is deliberate: "was this a good draft" only means anything
 * against the other nine drafts in the same room, with the same player pool.
 */
export function computeDraftQuality(teams: TeamDraftInput[]): DraftQualityResult {
  const notes: string[] = [];
  if (teams.length === 0) {
    return { teams: [], adpAvailable: false, weights: [], notes };
  }

  const totalPicks = Math.max(...teams.map((t) => t.picks.length), 1) * teams.length;
  const adpAvailable = teams.some((t) => t.picks.some((p) => p.adp != null));
  if (!adpAvailable) {
    notes.push(
      "Average draft position is not available for this season, so the value-vs-ADP factor is excluded and its weight is spread across the remaining factors. Everything else is measured from the draft board itself — where each player went relative to the other picks in the same room.",
    );
  }
  const byeAvailable = teams.some((t) => t.picks.some((p) => p.byeWeek != null));
  if (!byeAvailable) {
    notes.push(
      "NFL bye weeks are not on record for this season, so every team scores neutrally on bye-week spread.",
    );
  }

  /*
   * Starter quality prefers each player's positional standing going into the
   * draft. Where no player on the board has a prior season on record — the
   * first year of the archive, for instance — it falls back to pick order, and
   * the note says so, because that version of the factor really is a partial
   * restatement of the draft order.
   */
  const percentilesAvailable = teams.some((t) =>
    t.picks.some((p) => p.priorPositionalPercentile != null),
  );
  if (!percentilesAvailable) {
    notes.push(
      "No prior-season production is on record for the players in this draft, so starter quality falls back to where each starter was taken. That measures what the room believed rather than what the players had done, and this season's grades should be read with that in mind.",
    );
  }

  const metrics = teams.map((t) => {
    const { starters, bench, byPosition } = splitStarters(t.picks);

    // Value vs ADP: how many picks beat their market price, weighted by how far.
    const withAdp = t.picks.filter((p) => p.adp != null && !p.isKeeper);
    const adpValue = withAdp.length
      ? mean(withAdp.map((p) => (p.adp as number) - p.overallPickNumber))
      : 0;

    /*
     * Starter quality: how good the players filling the starting slots were at
     * their own positions going into the draft.
     *
     * Measured by prior-season positional standing, NOT by where each player
     * was taken. Grading a draft by pick number makes the grade a restatement
     * of the draft order — the manager with the first pick wins for having the
     * first pick. Pick number is only used as a last resort when no player on
     * the board has a prior season on record, and the notes say so when that
     * happens.
     *
     * Averaged over the slots that MUST be filled, not over the starters a team
     * happens to have. Averaging over filled starters rewarded failing to fill
     * slots: an all-RB roster can only start three players, and those three
     * were its earliest picks, so its "average starter" looked elite. Unfilled
     * slots contribute zero, which is what an empty slot is worth.
     */
    const rated = starters.filter((p) => p.priorPositionalPercentile != null);
    const starterQuality = percentilesAvailable
      ? rated.reduce((sum, p) => sum + (p.priorPositionalPercentile as number), 0) /
        REQUIRED_STARTERS
      : starters.reduce((sum, p) => sum + (totalPicks - p.overallPickNumber), 0) /
        REQUIRED_STARTERS;
    const starterCost = starters.length
      ? mean(starters.map((p) => p.overallPickNumber))
      : totalPicks;

    // Roster construction: every required slot filled, without hoarding.
    let filled = 0;
    let required = 0;
    for (const [pos, count] of Object.entries(STARTING_SLOTS)) {
      required += count;
      filled += Math.min(count, byPosition[pos] ?? 0);
    }
    const completeness = required > 0 ? filled / required : 0;
    // Penalise stacking one position far beyond any use for it.
    const overStock = Object.entries(byPosition).reduce((sum, [pos, count]) => {
      const useful = (STARTING_SLOTS[pos] ?? 0) + (FLEX_ELIGIBLE.has(pos) ? 2 : 1);
      return sum + Math.max(0, count - useful);
    }, 0);
    const construction = completeness * 100 - overStock * 4;

    // Positional scarcity: reward taking scarce positions early. Divided by the
    // required slot count for the same reason as starter quality — an unfilled
    // slot must not raise the average.
    const scarcity =
      starters.reduce((sum, p) => {
        const weight = SCARCITY_RANK[p.position ?? ""] ?? 0.3;
        const earliness = 1 - p.overallPickNumber / totalPicks;
        return sum + weight * earliness * 100;
      }, 0) / REQUIRED_STARTERS;

    // Bench upside: depth taken meaningfully before the end of the draft.
    const benchUpside = bench.length
      ? mean(bench.map((p) => Math.max(0, 1 - p.overallPickNumber / totalPicks) * 100))
      : 0;

    // Capital efficiency: value obtained per unit of draft capital spent. The
    // first pick a team owns tells us its slot, so a late slot isn't punished.
    const capital = t.picks.reduce(
      (sum, p) => sum + 100 / Math.sqrt(Math.max(1, p.overallPickNumber)),
      0,
    );
    const efficiency = capital > 0 ? starterQuality / capital : 0;

    // Bye-week spread: how concentrated starters' byes are.
    const byes = starters.map((p) => p.byeWeek).filter((b): b is number => b != null);
    const byeCounts = new Map<number, number>();
    for (const b of byes) byeCounts.set(b, (byeCounts.get(b) ?? 0) + 1);
    const worstBye = byeCounts.size ? Math.max(...byeCounts.values()) : 0;
    const byeSpread = byes.length ? -worstBye : 0;

    // Risk concentration: reliance on one NFL team.
    const teamCounts = new Map<string, number>();
    for (const p of t.picks) {
      if (!p.nflTeam) continue;
      teamCounts.set(p.nflTeam, (teamCounts.get(p.nflTeam) ?? 0) + 1);
    }
    const maxFromOneTeam = teamCounts.size ? Math.max(...teamCounts.values()) : 0;
    // Only the excess above an incidental stack counts; see RISK_FREE_STACK.
    const stackExcess = Math.max(0, maxFromOneTeam - RISK_FREE_STACK);
    const riskSpread = -stackExcess;

    return {
      team: t,
      adpValue,
      adpBeats: withAdp.filter((p) => (p.adp as number) > p.overallPickNumber).length,
      adpCount: withAdp.length,
      starterQuality,
      starterCost,
      construction,
      completeness,
      overStock,
      scarcity,
      benchUpside,
      efficiency,
      byeSpread,
      worstBye,
      riskSpread,
      stackExcess,
      maxFromOneTeam,
      byPosition,
      starters,
      bench,
    };
  });

  const range = (pick: (m: (typeof metrics)[number]) => number) => {
    const vals = metrics.map(pick).filter((v) => Number.isFinite(v));
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : { min: 0, max: 0 };
  };
  const rAdp = range((m) => m.adpValue);
  const rStarter = range((m) => m.starterQuality);
  const rConstruction = range((m) => m.construction);
  const rScarcity = range((m) => m.scarcity);
  const rBench = range((m) => m.benchUpside);
  const rEfficiency = range((m) => m.efficiency);
  const rBye = range((m) => m.byeSpread);
  const rRisk = range((m) => m.riskSpread);

  /*
   * A factor with nothing behind it is dropped, not scored 50. Scoring every
   * team the same still spends the factor's weight, and it left the report
   * cards discussing bye weeks nobody had data for.
   */
  const riskMeasurable = metrics.some((m) => m.stackExcess > 0);
  if (!riskMeasurable) {
    notes.push(
      `No manager drafted more than ${RISK_FREE_STACK} players from any one NFL team, which is what a draft of this length picks up incidentally. There is no concentration to grade, so the factor is excluded rather than scored neutrally.`,
    );
  }

  const available: Record<DraftFactorKey, boolean> = {
    valueVsAdp: adpAvailable,
    starterQuality: true,
    rosterConstruction: true,
    positionalScarcity: true,
    benchUpside: true,
    capitalEfficiency: true,
    byeWeekSpread: byeAvailable,
    riskConcentration: riskMeasurable,
  };

  const activeKeys = (Object.keys(DRAFT_WEIGHTS) as DraftFactorKey[]).filter((k) => available[k]);
  const weightTotal = activeKeys.reduce((sum, k) => sum + DRAFT_WEIGHTS[k], 0);
  const weightOf = (k: DraftFactorKey) => (weightTotal > 0 ? DRAFT_WEIGHTS[k] / weightTotal : 0);

  const graded = metrics.map((m) => {
    const values: Record<DraftFactorKey, number> = {
      valueVsAdp: normalize(m.adpValue, rAdp.min, rAdp.max),
      starterQuality: normalize(m.starterQuality, rStarter.min, rStarter.max),
      rosterConstruction: normalize(m.construction, rConstruction.min, rConstruction.max),
      positionalScarcity: normalize(m.scarcity, rScarcity.min, rScarcity.max),
      benchUpside: normalize(m.benchUpside, rBench.min, rBench.max),
      capitalEfficiency: normalize(m.efficiency, rEfficiency.min, rEfficiency.max),
      byeWeekSpread: normalize(m.byeSpread, rBye.min, rBye.max),
      riskConcentration: normalize(m.riskSpread, rRisk.min, rRisk.max),
    };

    const raws: Record<DraftFactorKey, string> = {
      valueVsAdp: m.adpCount ? `${m.adpBeats}/${m.adpCount} beat ADP` : "no ADP on record",
      starterQuality: percentilesAvailable
        ? `starters averaged the ${ordinal(Math.round(m.starterQuality))} percentile at their positions`
        : `avg starter pick ${round(m.starterCost)} (no prior-season data)`,
      rosterConstruction: `${Math.round(m.completeness * 100)}% lineup filled`,
      positionalScarcity: `${round(m.scarcity)} scarcity index (0-100, higher = scarce slots secured earlier)`,
      benchUpside: `${m.bench.length} bench picks`,
      capitalEfficiency: `${round(m.efficiency, 2)} starter quality per unit of draft capital`,
      byeWeekSpread: byeAvailable ? `${m.worstBye} starters share a bye` : "no bye data",
      riskConcentration: `${m.maxFromOneTeam} from one NFL team (${m.stackExcess} above the incidental ${RISK_FREE_STACK})`,
    };

    const factors: DraftFactor[] = activeKeys.map((key) => ({
      key,
      label: DRAFT_FACTOR_META[key].label,
      value: round(values[key]),
      weight: round(weightOf(key), 3),
      raw: raws[key],
    }));

    const score = activeKeys.reduce((sum, key) => sum + values[key] * weightOf(key), 0);

    return {
      fantasyTeamId: m.team.fantasyTeamId,
      managerId: m.team.managerId,
      managerName: m.team.managerName,
      score: round(score),
      factors,
      startersByPosition: m.byPosition,
      pickCount: m.team.picks.length,
      keeperCount: m.team.picks.filter((p) => p.isKeeper).length,
    };
  });

  graded.sort((a, b) => b.score - a.score || a.managerName.localeCompare(b.managerName));

  return {
    adpAvailable,
    notes,
    weights: activeKeys.map((key) => ({
      key,
      label: DRAFT_FACTOR_META[key].label,
      description: DRAFT_FACTOR_META[key].description,
      weight: round(weightOf(key), 3),
    })),
    teams: graded.map((t, i) => ({ ...t, rank: i + 1 })),
  };
}

export type GradeLetterValue =
  "A_PLUS" | "A" | "A_MINUS" | "B_PLUS" | "B" | "B_MINUS" | "C_PLUS" | "C" | "C_MINUS" | "D" | "F";

/**
 * Maps a composite 0-100 draft score onto a letter, by RANK within the season
 * rather than by absolute score.
 *
 * Rank-based because the composite is already relative: in a ten-team league
 * somebody drafted best and somebody drafted worst, and the curve says so.
 * An absolute cut-off would bunch every team into B/B+ exactly the way the
 * old heuristic did.
 */
export function letterFromDraftRank(rank: number, fieldSize: number): GradeLetterValue {
  if (fieldSize <= 0) return "C";
  const percentile = (rank - 1) / Math.max(1, fieldSize - 1);
  if (percentile <= 0.05) return "A_PLUS";
  if (percentile <= 0.15) return "A";
  if (percentile <= 0.28) return "A_MINUS";
  if (percentile <= 0.4) return "B_PLUS";
  if (percentile <= 0.55) return "B";
  if (percentile <= 0.65) return "B_MINUS";
  if (percentile <= 0.75) return "C_PLUS";
  if (percentile <= 0.85) return "C";
  if (percentile <= 0.92) return "C_MINUS";
  if (percentile < 1) return "D";
  return "F";
}
