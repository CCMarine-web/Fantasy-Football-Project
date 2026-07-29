/**
 * WHICH GAME IS THE MATCHUP OF THE WEEK.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * A pure, deterministic function over verified inputs. No model chooses the
 * featured game and no model supplies a number that feeds this decision. The AI
 * writes commentary about the game this file picks, from a research packet built
 * out of the same figures — which is the only order that cannot end with the
 * page recommending a game because a sentence sounded better.
 *
 * Determinism matters beyond tidiness: the featured game is cached and the copy
 * describing it is written once and stored against the matchup id. If the choice
 * could wobble between two renders, the page would show a preview of one game
 * above the card for another.
 *
 * ── What it weighs ────────────────────────────────────────────────────────
 * Six factors, each normalised 0-100 across the week's candidates, then blended:
 *
 *   Projected closeness      26%  how near the two sides are on the numbers
 *   Stakes                   22%  standings and playoff implications
 *   Official rivalry         18%  the commissioner's own list of grudges
 *   Combined quality         16%  the two power rankings added together
 *   Recent form              10%  are both sides playing well right now
 *   Historical closeness      8%  how tight the series has been
 *
 * Closeness leads because a blowout between the top two is a worse watch than a
 * coin-flip between the fourth and fifth. Rivalry is weighted heavily but cannot
 * win on its own: an official rivalry where one side is 1-8 and projected forty
 * points down is not the game of the week, and the league has one of those.
 *
 * ── Ties ──────────────────────────────────────────────────────────────────
 * Broken on matchupId, which is stable for the life of the row. Never on
 * anything derived from ordering, insertion or the clock.
 */

/** One candidate game, with everything the choice is allowed to consider. */
export interface FeaturedCandidate {
  matchupId: string;
  /**
   * A consolation-bracket game is never eligible. It decides nothing, the site
   * does not count it, and featuring one would contradict every other page.
   */
  bracket?: "WINNERS" | "CONSOLATION" | null;
  isPlayoff: boolean;
  /**
   * Projected points for each side, when the platform published them. Null
   * before projections exist; after the game is final the actual scores are
   * passed instead, so the same weighting picks the best game to recap.
   */
  projectedA: number | null;
  projectedB: number | null;
  /** Power-ranking positions, 1 = best. Null when nothing has been ranked yet. */
  powerRankA: number | null;
  powerRankB: number | null;
  /** How many teams are in the ranking, so positions can be normalised. */
  teamsRanked: number;
  /** Current regular-season records. Zeros before week 1. */
  winsA: number;
  lossesA: number;
  winsB: number;
  lossesB: number;
  /** Standings positions, 1 = top. Null before any game is played. */
  standingA: number | null;
  standingB: number | null;
  /** Teams that make the postseason, so "in the hunt" is not a guess. */
  playoffSpots: number;
  /** True when the commissioner's list names this pair an official rivalry. */
  isOfficialRivalry: boolean;
  /** Verified head-to-head meetings, and the mean margin across them. */
  headToHeadGames: number;
  headToHeadAverageMargin: number | null;
  /** Results over each side's last three games, most recent first. */
  recentFormA: ("W" | "L" | "T")[];
  recentFormB: ("W" | "L" | "T")[];
  /** Weeks left in the regular season, which is what makes a game matter. */
  weeksRemaining: number;
}

export const FEATURED_WEIGHTS = {
  projectedCloseness: 0.26,
  stakes: 0.22,
  officialRivalry: 0.18,
  combinedQuality: 0.16,
  recentForm: 0.1,
  historicalCloseness: 0.08,
} as const;

export type FeaturedFactorKey = keyof typeof FEATURED_WEIGHTS;

export const FEATURED_FACTOR_LABEL: Record<FeaturedFactorKey, string> = {
  projectedCloseness: "Projected closeness",
  stakes: "Standings stakes",
  officialRivalry: "Official rivalry",
  combinedQuality: "Combined power ranking",
  recentForm: "Recent form",
  historicalCloseness: "Historical closeness",
};

export interface FeaturedFactor {
  key: FeaturedFactorKey;
  label: string;
  /** 0-100 after normalising across the week's candidates. */
  value: number;
  /** Share of the score, after any unmeasurable factor is dropped. */
  weight: number;
  /** Why it scored that, in plain English, for the "why this game" note. */
  reason: string;
}

export interface FeaturedChoice {
  matchupId: string;
  /** 0-100 composite. */
  score: number;
  factors: FeaturedFactor[];
  /** Every candidate's score, best first — for diagnostics and tests. */
  ranked: { matchupId: string; score: number }[];
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * Min-max normalisation over the candidates that have a value.
 *
 * A single candidate, or a set where every value is identical, maps to 50 rather
 * than dividing by zero — the factor genuinely does not distinguish them.
 */
function normaliseAcross(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (present.length === 0) return values.map(() => null);
  const min = Math.min(...present);
  const max = Math.max(...present);
  if (max - min < 1e-9) return values.map((v) => (v == null ? null : 50));
  return values.map((v) => (v == null ? null : ((v - min) / (max - min)) * 100));
}

/** Win rate from a partial record; null before anybody has played. */
function winRate(wins: number, losses: number): number | null {
  const games = wins + losses;
  return games > 0 ? wins / games : null;
}

/** Form as a 0-1 rate over the games supplied, most recent weighted heaviest. */
function formRate(results: ("W" | "L" | "T")[]): number | null {
  if (results.length === 0) return null;
  let total = 0;
  let weight = 0;
  results.forEach((result, index) => {
    const w = 1 / (index + 1); // most recent game counts most
    total += (result === "W" ? 1 : result === "T" ? 0.5 : 0) * w;
    weight += w;
  });
  return weight > 0 ? total / weight : null;
}

/**
 * Raw, un-normalised measures for one candidate. Each is "higher is a better
 * game to feature", or null when the data cannot support it.
 */
function measure(c: FeaturedCandidate) {
  // ── Projected closeness. A smaller gap is a better game, so the measure is
  // negated before normalisation.
  const gap =
    c.projectedA != null && c.projectedB != null ? Math.abs(c.projectedA - c.projectedB) : null;

  // ── Stakes. Both sides plausibly in the hunt, near the playoff cut line, with
  // the season running out. Before any game is played there are no standings, so
  // this is null and its weight is redistributed rather than scored as zero —
  // treating a preseason week as "no stakes" would let noise pick the game.
  let stakes: number | null = null;
  if (c.standingA != null && c.standingB != null && c.playoffSpots > 0) {
    const cut = c.playoffSpots + 0.5;
    // Distance from the cut line, so a game between the teams either side of it
    // scores highest.
    const distance = (Math.abs(c.standingA - cut) + Math.abs(c.standingB - cut)) / 2;
    const proximity = 1 / (1 + distance);
    // Late-season games matter more; an identical table in week 2 does not.
    const urgency = c.weeksRemaining <= 0 ? 1 : 1 / (1 + c.weeksRemaining / 4);
    // A game between two good teams is worth more than one between two bad ones
    // at the same distance from the line.
    const rateA = winRate(c.winsA, c.lossesA);
    const rateB = winRate(c.winsB, c.lossesB);
    const quality = rateA != null && rateB != null ? (rateA + rateB) / 2 : 0.5;
    stakes = proximity * 0.5 + urgency * 0.3 + quality * 0.2;
    // A playoff game is the stakes, whatever the table says.
    if (c.isPlayoff) stakes = 1;
  } else if (c.isPlayoff) {
    stakes = 1;
  }

  // ── Combined quality. Two top-ranked sides beat two bottom-ranked ones.
  const combined =
    c.powerRankA != null && c.powerRankB != null && c.teamsRanked > 0
      ? // Invert: rank 1 is best, so a low sum is a high score.
        1 - (c.powerRankA + c.powerRankB - 2) / Math.max(1, 2 * (c.teamsRanked - 1))
      : null;

  // ── Recent form. Both sides playing well, and neither carrying the game.
  const formA = formRate(c.recentFormA);
  const formB = formRate(c.recentFormB);
  const form =
    formA != null && formB != null
      ? // Mean form, docked for a mismatch — 3-0 against 0-3 is not a good game.
        (formA + formB) / 2 - Math.abs(formA - formB) * 0.25
      : null;

  // ── Historical closeness. Only meaningful once the pair has real history.
  const MIN_HISTORY = 3;
  const historical =
    c.headToHeadGames >= MIN_HISTORY && c.headToHeadAverageMargin != null
      ? -c.headToHeadAverageMargin // tighter series scores higher
      : null;

  return {
    projectedCloseness: gap == null ? null : -gap,
    stakes,
    officialRivalry: c.isOfficialRivalry ? 1 : 0,
    combinedQuality: combined,
    recentForm: form,
    historicalCloseness: historical,
  };
}

/** Plain-English note for one factor, so the page can say why this game. */
function reasonFor(key: FeaturedFactorKey, c: FeaturedCandidate): string {
  switch (key) {
    case "projectedCloseness": {
      if (c.projectedA == null || c.projectedB == null) return "no projections published";
      const gap = Math.abs(c.projectedA - c.projectedB);
      return `${gap.toFixed(1)} points between them on projections`;
    }
    case "stakes": {
      if (c.isPlayoff) return "a playoff game";
      if (c.standingA == null || c.standingB == null) return "no standings yet";
      return `${c.standingA}${c.standingA === c.standingB ? "" : ` and ${c.standingB}`} in the table with ${c.weeksRemaining} week${c.weeksRemaining === 1 ? "" : "s"} to play`;
    }
    case "officialRivalry":
      return c.isOfficialRivalry ? "an official league rivalry" : "not an official rivalry";
    case "combinedQuality": {
      if (c.powerRankA == null || c.powerRankB == null) return "nothing ranked yet";
      return `ranked ${c.powerRankA} and ${c.powerRankB} of ${c.teamsRanked}`;
    }
    case "recentForm": {
      const describe = (form: ("W" | "L" | "T")[]) =>
        form.length === 0 ? "no games yet" : form.join("");
      return `${describe(c.recentFormA)} against ${describe(c.recentFormB)}`;
    }
    case "historicalCloseness": {
      if (c.headToHeadGames < 3 || c.headToHeadAverageMargin == null) {
        return `only ${c.headToHeadGames} previous meeting${c.headToHeadGames === 1 ? "" : "s"}`;
      }
      return `${c.headToHeadAverageMargin.toFixed(1)}-point average margin over ${c.headToHeadGames} meetings`;
    }
  }
}

/**
 * Picks the Matchup of the Week. Returns null when there is nothing eligible.
 *
 * Consolation-bracket games are removed before anything is scored, so they can
 * never be featured however close they are.
 */
export function chooseFeaturedMatchup(candidates: FeaturedCandidate[]): FeaturedChoice | null {
  const eligible = candidates.filter((c) => c.bracket !== "CONSOLATION");
  if (eligible.length === 0) return null;

  const raw = eligible.map(measure);
  const keys = Object.keys(FEATURED_WEIGHTS) as FeaturedFactorKey[];

  // Normalise each factor across the week's candidates.
  const normalised = new Map<FeaturedFactorKey, (number | null)[]>();
  for (const key of keys) {
    normalised.set(
      key,
      normaliseAcross(raw.map((r) => r[key])),
    );
  }

  const scored = eligible.map((candidate, index) => {
    // Drop any factor with no data for this candidate and rescale the rest, so a
    // missing measure never reads as a zero score.
    const usable = keys.filter((key) => normalised.get(key)![index] != null);
    const totalWeight = usable.reduce((sum, key) => sum + FEATURED_WEIGHTS[key], 0);

    const factors: FeaturedFactor[] = usable.map((key) => ({
      key,
      label: FEATURED_FACTOR_LABEL[key],
      value: round(clamp(normalised.get(key)![index] as number)),
      weight: totalWeight === 0 ? 0 : FEATURED_WEIGHTS[key] / totalWeight,
      reason: reasonFor(key, candidate),
    }));

    const score =
      totalWeight === 0
        ? 50
        : usable.reduce(
            (sum, key) =>
              sum +
              clamp(normalised.get(key)![index] as number) * (FEATURED_WEIGHTS[key] / totalWeight),
            0,
          );

    return { candidate, score: round(score), factors };
  });

  // Highest score wins; ties break on matchupId so the choice is reproducible.
  scored.sort((a, b) => b.score - a.score || a.candidate.matchupId.localeCompare(b.candidate.matchupId));

  const winner = scored[0];
  return {
    matchupId: winner.candidate.matchupId,
    score: winner.score,
    factors: winner.factors,
    ranked: scored.map((s) => ({ matchupId: s.candidate.matchupId, score: s.score })),
  };
}
