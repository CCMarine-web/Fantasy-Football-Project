/**
 * DRAFT RETURNS — the "revisited" grade.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 * The old revisited grade was `letterFromFinish`: champion got an A+, last
 * place an F, everyone else by final rank. That is a grade for the SEASON, not
 * for the draft in hindsight. It rewarded a manager who drafted badly and won
 * on waivers, and failed a manager who drafted brilliantly and lost four
 * one-point games.
 *
 * This grades what the drafted players actually produced.
 *
 * ── The measure ───────────────────────────────────────────────────────────
 * Every player taken in the draft is ranked by what they went on to produce.
 * A pick's value is then the gap between where it was taken and where the
 * player finished in that ranking:
 *
 *     valueDelta = overallPickNumber - actualProductionRank
 *
 * Positive means the player outproduced their draft slot. This is deliberately
 * scale-free: it does not care how many points the league scores, only whether
 * a manager's selections beat the room's own consensus at the time.
 *
 * ── Injuries and matchup luck ─────────────────────────────────────────────
 * Production is measured PER GAME PLAYED, not as a season total. A player who
 * was excellent across nine games before getting hurt still ranks as an
 * excellent player, so a good pick is not retroactively failed for an injury
 * the manager could not have known about. Games played is reported alongside so
 * commentary can mention availability without it driving the grade.
 *
 * Nothing here reads a win, a loss, a playoff berth, a final placing or a
 * championship. Matchup luck cannot reach this number at all.
 *
 * ── When it cannot be computed ────────────────────────────────────────────
 * It needs per-player weekly scoring. ESPN's archived seasons do not expose
 * that, so for 2017-2022 there is no revisited grade and the page says so
 * rather than falling back to final standings.
 */

export const RETURN_WEIGHTS = {
  valueVsSlot: 0.4,
  earlyRoundReturn: 0.2,
  hitRate: 0.25,
  topEndOutcome: 0.15,
} as const;

export type ReturnFactorKey = keyof typeof RETURN_WEIGHTS;

export const RETURN_FACTOR_META: Record<ReturnFactorKey, { label: string; description: string }> = {
  valueVsSlot: {
    label: "Value vs draft slot",
    description:
      "How far each pick outproduced (or fell short of) the position it was taken at, across the whole board.",
  },
  earlyRoundReturn: {
    label: "Early-round return",
    description:
      "The same measure restricted to rounds 1-5, where a draft is actually won or lost. Stops a lucky late flyer masking a busted first round.",
  },
  hitRate: {
    label: "Hit rate",
    description: "Share of picks that went on to produce at genuine starter level for the league.",
  },
  topEndOutcome: {
    label: "Best pick",
    description:
      "Per-game production of the team's single best selection — the ceiling the draft delivered.",
  },
};

/** How many rounds count as "early". */
const EARLY_ROUNDS = 5;

export interface PickReturnInput {
  overallPickNumber: number;
  round: number;
  isKeeper: boolean;
  playerId: string | null;
  playerName: string;
  /** Total points the player scored that season while on any roster. */
  totalPoints: number | null;
  /** Weeks in which the player registered a score. */
  gamesPlayed: number;
}

export interface TeamReturnInput {
  fantasyTeamId: string;
  managerId: string;
  managerName: string;
  picks: PickReturnInput[];
}

export interface ReturnFactor {
  key: ReturnFactorKey;
  label: string;
  value: number;
  weight: number;
  raw: string;
}

export interface TeamDraftReturn {
  fantasyTeamId: string;
  managerId: string;
  managerName: string;
  score: number;
  rank: number;
  factors: ReturnFactor[];
  /** The picks that most outperformed their slot, best first. */
  bestPicks: {
    playerName: string;
    round: number;
    pickNumber: number;
    pointsPerGame: number;
    valueDelta: number;
  }[];
  /** The picks that most underperformed, worst first. */
  worstPicks: {
    playerName: string;
    round: number;
    pickNumber: number;
    pointsPerGame: number;
    valueDelta: number;
    gamesPlayed: number;
  }[];
}

export interface DraftReturnsResult {
  teams: TeamDraftReturn[];
  weights: { key: ReturnFactorKey; label: string; description: string; weight: number }[];
  /** False when there is no per-player scoring for the season. */
  available: boolean;
  notes: string[];
}

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
 * Grades what each team's draft actually returned.
 *
 * `starterSlots` is how many players the league starts each week; it defines
 * what "starter level" means for the hit-rate factor.
 */
export function computeDraftReturns(
  teams: TeamReturnInput[],
  starterSlots = 9,
): DraftReturnsResult {
  const weights = (Object.keys(RETURN_WEIGHTS) as ReturnFactorKey[]).map((key) => ({
    key,
    label: RETURN_FACTOR_META[key].label,
    description: RETURN_FACTOR_META[key].description,
    weight: RETURN_WEIGHTS[key],
  }));

  const allPicks = teams.flatMap((t) => t.picks);
  const withProduction = allPicks.filter((p) => p.totalPoints != null && p.gamesPlayed > 0);
  if (teams.length === 0 || withProduction.length === 0) {
    return {
      teams: [],
      weights,
      available: false,
      notes: [
        "Per-player weekly scoring is not on record for this season, so how the drafted players actually performed cannot be measured. No revisited grade is issued — falling back to final standings would grade the season rather than the draft.",
      ],
    };
  }

  // Rank every drafted player by per-game production. Per game, not total, so
  // an injury-shortened season does not retroactively fail a good pick.
  const perGame = new Map<string, number>();
  for (const pick of withProduction) {
    const key = pick.playerId ?? `${pick.overallPickNumber}`;
    perGame.set(key, (pick.totalPoints as number) / pick.gamesPlayed);
  }
  const ranked = [...withProduction]
    .map((p) => ({ pick: p, ppg: perGame.get(p.playerId ?? `${p.overallPickNumber}`) ?? 0 }))
    .sort((a, b) => b.ppg - a.ppg);

  const actualRank = new Map<string, number>();
  ranked.forEach((entry, index) => {
    const key = entry.pick.playerId ?? `${entry.pick.overallPickNumber}`;
    if (!actualRank.has(key)) actualRank.set(key, index + 1);
  });

  // "Starter level" = the top (starterSlots x teams) producers of the class.
  const starterThreshold = Math.max(1, starterSlots * teams.length);

  const detailed = teams.map((team) => {
    const scored = team.picks.map((pick) => {
      const key = pick.playerId ?? `${pick.overallPickNumber}`;
      const ppg = perGame.get(key) ?? 0;
      const rank = actualRank.get(key) ?? withProduction.length + 1;
      return {
        pick,
        ppg,
        rank,
        // A pick that never scored is treated as finishing behind the whole
        // class rather than being dropped, otherwise a bust would be invisible.
        valueDelta: pick.overallPickNumber - rank,
        starter: rank <= starterThreshold,
      };
    });

    const early = scored.filter((s) => s.pick.round <= EARLY_ROUNDS);
    const byValue = [...scored].sort((a, b) => b.valueDelta - a.valueDelta);

    return {
      team,
      scored,
      valueVsSlot: mean(scored.map((s) => s.valueDelta)),
      earlyRoundReturn: early.length ? mean(early.map((s) => s.valueDelta)) : 0,
      hitRate: scored.length ? scored.filter((s) => s.starter).length / scored.length : 0,
      topEnd: scored.length ? Math.max(...scored.map((s) => s.ppg)) : 0,
      best: byValue.slice(0, 3),
      worst: [...byValue].reverse().slice(0, 3),
    };
  });

  const range = (pick: (d: (typeof detailed)[number]) => number) => {
    const vals = detailed.map(pick).filter((v) => Number.isFinite(v));
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : { min: 0, max: 0 };
  };
  const rValue = range((d) => d.valueVsSlot);
  const rEarly = range((d) => d.earlyRoundReturn);
  const rHit = range((d) => d.hitRate);
  const rTop = range((d) => d.topEnd);

  const graded = detailed.map((d) => {
    const values: Record<ReturnFactorKey, number> = {
      valueVsSlot: normalize(d.valueVsSlot, rValue.min, rValue.max),
      earlyRoundReturn: normalize(d.earlyRoundReturn, rEarly.min, rEarly.max),
      hitRate: normalize(d.hitRate, rHit.min, rHit.max),
      topEndOutcome: normalize(d.topEnd, rTop.min, rTop.max),
    };
    const raws: Record<ReturnFactorKey, string> = {
      valueVsSlot: `${d.valueVsSlot >= 0 ? "+" : ""}${round(d.valueVsSlot)} slots per pick`,
      earlyRoundReturn: `${d.earlyRoundReturn >= 0 ? "+" : ""}${round(d.earlyRoundReturn)} slots (R1-${EARLY_ROUNDS})`,
      hitRate: `${Math.round(d.hitRate * 100)}% at starter level`,
      topEndOutcome: `${round(d.topEnd)} pts/gm best pick`,
    };

    const factors: ReturnFactor[] = (Object.keys(RETURN_WEIGHTS) as ReturnFactorKey[]).map(
      (key) => ({
        key,
        label: RETURN_FACTOR_META[key].label,
        value: round(values[key]),
        weight: RETURN_WEIGHTS[key],
        raw: raws[key],
      }),
    );

    const score = (Object.keys(RETURN_WEIGHTS) as ReturnFactorKey[]).reduce(
      (sum, key) => sum + values[key] * RETURN_WEIGHTS[key],
      0,
    );

    return {
      fantasyTeamId: d.team.fantasyTeamId,
      managerId: d.team.managerId,
      managerName: d.team.managerName,
      score: round(score),
      factors,
      bestPicks: d.best.map((s) => ({
        playerName: s.pick.playerName,
        round: s.pick.round,
        pickNumber: s.pick.overallPickNumber,
        pointsPerGame: round(s.ppg),
        valueDelta: round(s.valueDelta, 0),
      })),
      worstPicks: d.worst.map((s) => ({
        playerName: s.pick.playerName,
        round: s.pick.round,
        pickNumber: s.pick.overallPickNumber,
        pointsPerGame: round(s.ppg),
        valueDelta: round(s.valueDelta, 0),
        gamesPlayed: s.pick.gamesPlayed,
      })),
    };
  });

  graded.sort((a, b) => b.score - a.score || a.managerName.localeCompare(b.managerName));

  return {
    available: true,
    weights,
    notes: [
      "Production is measured per game played, so a pick whose season was cut short by injury is judged on how good the player was, not how long they lasted.",
    ],
    teams: graded.map((t, i) => ({ ...t, rank: i + 1 })),
  };
}
