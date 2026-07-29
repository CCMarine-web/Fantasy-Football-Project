// Draft report-card persistence + the deterministic grade heuristics.
//
// Design point: the LETTER grade is derived here, deterministically, from
// outcome signals — so grades are meaningful even when the AI runs on the mock
// provider (no OPENAI_API_KEY). The AI (draft-grade.ts) only writes the prose
// RATIONALE. Grades are generate-once-reuse: once a manager has a grade for a
// season we skip it on re-runs unless `force` is passed, so the weekly pipeline
// can call these repeatedly without regenerating (or paying for) existing grades.

import { prisma } from "@/lib/db";
import { positionLabel } from "@/lib/format";
import { GradeLetter, type Prisma } from "@/generated/prisma/client";
import {
  computeDraftQuality,
  letterFromDraftRank,
  DRAFT_FACTOR_META,
  DRAFT_WEIGHTS,
  type DraftFactor,
  type DraftFactorKey,
} from "@/server/stats/draft-quality";
import {
  computeDraftReturns,
  RETURN_FACTOR_META,
  RETURN_WEIGHTS,
  type ReturnFactorKey,
  type TeamReturnInput,
} from "@/server/stats/draft-returns";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import {
  generateDraftRationale,
  generateDraftRevisitRationale,
} from "@/server/ai/services/draft-grade";

// ---------------------------------------------------------------------------
// Grade <-> display mapping
// ---------------------------------------------------------------------------

const GRADE_DISPLAY: Record<GradeLetter, string> = {
  A_PLUS: "A+",
  A: "A",
  A_MINUS: "A-",
  B_PLUS: "B+",
  B: "B",
  B_MINUS: "B-",
  C_PLUS: "C+",
  C: "C",
  C_MINUS: "C-",
  D: "D",
  F: "F",
};

/** Human-readable letter, e.g. GradeLetter.A_MINUS -> "A-". */
export function gradeLetterToDisplay(grade: GradeLetter | null | undefined): string {
  return grade ? GRADE_DISPLAY[grade] : "—";
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

/**
 * ORIGINAL (draft-day) grade.
 *
 * This used to be a near-constant: B+ for everyone, B if you leaned on
 * keepers, which told a reader nothing. The letter now comes from the
 * draft-quality model in server/stats/draft-quality.ts, which scores the
 * actual decisions — value against the room, starter quality, roster balance,
 * positional scarcity, bench depth, capital efficiency, byes and risk — and
 * nothing about how the season subsequently went.
 *
 * See `letterFromDraftRank` for why the letter is assigned by rank within the
 * season rather than by an absolute score.
 */
export { letterFromDraftRank } from "@/server/stats/draft-quality";

/*
 * The REVISITED grade no longer derives from final standings. A
 * `letterFromFinish` helper used to map champion -> A+ and last place -> F,
 * which graded the season rather than the draft; it has been deleted so it
 * cannot be wired back in. See `revisitDraftGradesForSeason` and
 * server/stats/draft-returns.ts.
 */

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function pickLine(pick: {
  round: number;
  isKeeper: boolean;
  player: { firstName: string; lastName: string; position: string; nflTeam: string | null } | null;
}): string {
  // `positionLabel` so a defence reaches the writer as "Team D/ST" rather than
  // the platform's "DEF", which was being repeated verbatim into the copy.
  const name = pick.player
    ? `${pick.player.firstName} ${pick.player.lastName} (${positionLabel(pick.player.position)}${
        pick.player.nflTeam ? `, ${pick.player.nflTeam}` : ""
      })`
    : "(empty pick)";
  return `Round ${pick.round}: ${name}${pick.isKeeper ? " [KEEPER]" : ""}`;
}

export interface GenerateGradesResult {
  seasonId: string;
  created: number;
  skipped: number;
}

/**
 * Generate ORIGINAL draft grades for every manager who drafted in this season.
 * Generate-once-reuse: skips managers who already have a grade unless `force`.
 * Exported so it can be wired into the weekly pipeline.
 */
/**
 * Every player's positional standing in the season BEFORE `seasonYear`, as a
 * percentile of points per game among players at the same position.
 *
 * This is what a draft room could plausibly have known, so it is a fair
 * measure of whether a pick was a good one — unlike the pick's own number,
 * which only records what the room decided. Players with fewer than three
 * recorded games are left out of the pool and get no percentile, because three
 * weeks is not a rate; rookies get none for the same reason.
 */
async function buildPriorPositionalPercentiles(seasonYear: number): Promise<Map<string, number>> {
  const rows = await prisma.weeklyPlayerScore.findMany({
    where: {
      points: { not: null },
      roster: { fantasyTeam: { season: { year: seasonYear - 1 } } },
    },
    select: { playerId: true, points: true, player: { select: { position: true } } },
  });

  const totals = new Map<string, { position: string; points: number; games: number }>();
  for (const row of rows) {
    if (row.points == null) continue;
    const cur = totals.get(row.playerId) ?? { position: row.player.position, points: 0, games: 0 };
    cur.points += row.points;
    cur.games += 1;
    totals.set(row.playerId, cur);
  }

  const byPosition = new Map<string, { playerId: string; ppg: number }[]>();
  for (const [playerId, t] of totals) {
    if (t.games < 3) continue;
    const list = byPosition.get(t.position) ?? [];
    list.push({ playerId, ppg: t.points / t.games });
    byPosition.set(t.position, list);
  }

  const out = new Map<string, number>();
  for (const list of byPosition.values()) {
    if (list.length < 3) continue;
    for (const entry of list) {
      const below = list.filter((x) => x.ppg < entry.ppg).length;
      out.set(entry.playerId, Math.round((below / list.length) * 100));
    }
  }
  return out;
}

export async function generateDraftGradesForSeason(
  seasonId: string,
  options: { force?: boolean } = {}
): Promise<GenerateGradesResult> {
  const draft = await prisma.draft.findUnique({
    where: { seasonId },
    include: {
      season: { select: { year: true } },
      picks: {
        include: { player: true, manager: true },
        orderBy: [{ round: "asc" }, { pickNumber: "asc" }],
      },
    },
  });

  if (!draft) return { seasonId, created: 0, skipped: 0 };

  const seasonYear = draft.season.year;
  const safeguards = await getContentSafeguards();

  // Group picks by manager.
  const byManager = new Map<string, { managerName: string; fantasyTeamId: string; picks: typeof draft.picks }>();
  for (const pick of draft.picks) {
    if (!pick.managerId) continue;
    const entry = byManager.get(pick.managerId) ?? {
      managerName: pick.manager?.displayName ?? "Unknown Manager",
      fantasyTeamId: pick.fantasyTeamId,
      picks: [] as typeof draft.picks,
    };
    entry.picks.push(pick);
    byManager.set(pick.managerId, entry);
  }

  /*
   * Each drafted player's standing at his own position going INTO this draft,
   * as a percentile of prior-season points per game. This is what starter
   * quality is measured against; see the comment on `priorPositionalPercentile`
   * in server/stats/draft-quality.ts for why pick number is not used.
   */
  const priorPercentile = await buildPriorPositionalPercentiles(seasonYear);

  // Score the whole room at once — "was this a good draft" is only meaningful
  // relative to the other drafts made from the same player pool.
  const quality = computeDraftQuality(
    [...byManager.entries()].map(([managerId, entry]) => ({
      fantasyTeamId: entry.fantasyTeamId,
      managerId,
      managerName: entry.managerName,
      picks: entry.picks.map((p) => ({
        overallPickNumber: p.pickNumber,
        round: p.round,
        isKeeper: p.isKeeper,
        position: p.player?.position ?? null,
        nflTeam: p.player?.nflTeam ?? null,
        // No historical ADP source is available for this league (see the note
        // in draft-quality.ts); leaving these null makes the model drop the
        // factor and say so rather than silently invent a market price.
        adp: null,
        byeWeek: null,
        priorPositionalPercentile: p.playerId ? (priorPercentile.get(p.playerId) ?? null) : null,
      })),
    })),
  );
  const gradedByManager = new Map(quality.teams.map((t) => [t.managerId, t]));

  let created = 0;
  let skipped = 0;

  for (const [managerId, { managerName, picks }] of byManager) {
    if (!options.force) {
      const existing = await prisma.draftGrade.findUnique({
        where: { seasonId_managerId: { seasonId, managerId } },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
    }

    const scored = gradedByManager.get(managerId);
    if (!scored) {
      skipped += 1;
      continue;
    }

    const totalPicks = picks.filter((p) => p.player).length;
    const keepers = picks.filter((p) => p.isKeeper).length;
    const grade = letterFromDraftRank(scored.rank, quality.teams.length) as GradeLetter;

    const { text, providerName } = await generateDraftRationale(
      {
        seasonYear,
        managerName,
        derivedGrade: gradeLetterToDisplay(grade),
        totalPicks,
        keepers,
        rounds: draft.rounds,
        picks: picks.map(pickLine),
        draftScore: scored.score,
        rankInLeague: `${scored.rank} of ${quality.teams.length}`,
        factorBreakdown: [...scored.factors]
          .sort((a, b) => b.value - a.value)
          .map((f) => `${f.label} ${Math.round(f.value)}/100 (${f.raw})`),
        dataCaveat: quality.adpAvailable ? undefined : quality.notes[0],
      },
      safeguards,
    );

    const data = {
      grade,
      rationale: text,
      originalScore: scored.score,
      originalFactors: scored.factors as unknown as Prisma.InputJsonValue,
      adpAvailable: quality.adpAvailable,
      providerName: providerName || "computed",
    };

    await prisma.draftGrade.upsert({
      where: { seasonId_managerId: { seasonId, managerId } },
      create: { seasonId, managerId, ...data },
      update: { ...data, generatedAt: new Date() },
    });
    created += 1;
  }

  return { seasonId, created, skipped };
}

export interface RevisitGradesResult {
  seasonId: string;
  revisited: number;
  skipped: number;
  /** Stale standings-derived grades removed because the season can't support one. */
  cleared?: number;
  /** Why no revisited grade could be issued for this season. */
  unavailableReason?: string;
}

/**
 * Recomputes REVISITED grades for COMPLETE seasons from what the drafted
 * players actually produced.
 *
 * This used to grade final standings — champion A+, last place F — which
 * measured the season, not the draft in hindsight. It now uses the draft-return
 * model (server/stats/draft-returns.ts): per-game production of each selection
 * against the slot it was taken at. Wins, playoff berths and championships are
 * not inputs, and per-game measurement means an injury-shortened season does
 * not retroactively fail a good pick.
 *
 * Seasons without per-player weekly scoring (the whole ESPN era) get NO
 * revisited grade — any existing one is cleared, because a stale
 * standings-derived letter is worse than an honest absence.
 */
export async function revisitDraftGradesForSeason(
  seasonId: string,
  options: { force?: boolean } = {}
): Promise<RevisitGradesResult> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { year: true, status: true },
  });

  if (!season || season.status !== "COMPLETE") {
    return { seasonId, revisited: 0, skipped: 0 };
  }

  const [grades, picks, playerTotals] = await Promise.all([
    prisma.draftGrade.findMany({
      where: { seasonId },
      include: { manager: { select: { displayName: true } } },
    }),
    prisma.draftPick.findMany({
      where: { draft: { seasonId } },
      select: {
        round: true,
        pickNumber: true,
        isKeeper: true,
        managerId: true,
        fantasyTeamId: true,
        player: { select: { id: true, firstName: true, lastName: true, position: true } },
        manager: { select: { displayName: true } },
      },
      orderBy: { pickNumber: "asc" },
    }),
    // Season-long production per player, from the weeks actually scored.
    prisma.weeklyPlayerScore.groupBy({
      by: ["playerId"],
      where: { roster: { fantasyTeam: { seasonId } }, points: { not: null } },
      _sum: { points: true },
      _count: { _all: true },
    }),
  ]);

  const production = new Map(playerTotals.map((row) => [row.playerId, { total: row._sum.points ?? 0, games: row._count._all }]));

  const byManager = new Map<string, TeamReturnInput>();
  for (const pick of picks) {
    if (!pick.managerId) continue;
    const entry =
      byManager.get(pick.managerId) ??
      ({
        fantasyTeamId: pick.fantasyTeamId,
        managerId: pick.managerId,
        managerName: pick.manager?.displayName ?? "Unknown Manager",
        picks: [],
      } satisfies TeamReturnInput);
    const stats = pick.player ? production.get(pick.player.id) : undefined;
    entry.picks.push({
      overallPickNumber: pick.pickNumber,
      round: pick.round,
      isKeeper: pick.isKeeper,
      playerId: pick.player?.id ?? null,
      playerName: pick.player ? `${pick.player.firstName} ${pick.player.lastName}` : "(no player on record)",
      totalPoints: stats?.total ?? null,
      gamesPlayed: stats?.games ?? 0,
    });
    byManager.set(pick.managerId, entry);
  }

  const returns = computeDraftReturns([...byManager.values()]);
  const safeguards = await getContentSafeguards();

  let revisited = 0;
  let skipped = 0;

  if (!returns.available) {
    // Clear any grade left over from the old standings-based rule.
    const { count } = await prisma.draftGrade.updateMany({
      where: { seasonId, OR: [{ revisitedGrade: { not: null } }, { revisitedRationale: { not: null } }] },
      data: { revisitedGrade: null, revisitedRationale: null, revisitedAt: null },
    });
    return { seasonId, revisited: 0, skipped: grades.length, cleared: count, unavailableReason: returns.notes[0] };
  }

  const returnByManager = new Map(returns.teams.map((t) => [t.managerId, t]));

  for (const grade of grades) {
    if (grade.revisitedAt && !options.force) {
      skipped += 1;
      continue;
    }
    const outcome = returnByManager.get(grade.managerId);
    if (!outcome) {
      skipped += 1;
      continue;
    }

    const revisitedGrade = letterFromDraftRank(outcome.rank, returns.teams.length) as GradeLetter;

    const { text, providerName } = await generateDraftRevisitRationale(
      {
        seasonYear: season.year,
        managerName: grade.manager.displayName,
        originalGrade: gradeLetterToDisplay(grade.grade),
        originalRationale: grade.rationale ?? undefined,
        revisitedGrade: gradeLetterToDisplay(revisitedGrade),
        returnScore: outcome.score,
        returnRank: `${outcome.rank} of ${returns.teams.length}`,
        factorBreakdown: [...outcome.factors]
          .sort((a, b) => b.value - a.value)
          .map((f) => `${f.label} ${Math.round(f.value)}/100 (${f.raw})`),
        bestPicks: outcome.bestPicks.map(
          (p) => `R${p.round} pick ${p.pickNumber} ${p.playerName}: ${p.pointsPerGame} pts/gm, ${p.valueDelta >= 0 ? "+" : ""}${p.valueDelta} slots vs where he went`,
        ),
        worstPicks: outcome.worstPicks.map(
          (p) => `R${p.round} pick ${p.pickNumber} ${p.playerName}: ${p.pointsPerGame} pts/gm across ${p.gamesPlayed} game(s), ${p.valueDelta >= 0 ? "+" : ""}${p.valueDelta} slots`,
        ),
      },
      safeguards
    );

    await prisma.draftGrade.update({
      where: { id: grade.id },
      data: {
        revisitedGrade,
        revisitedRationale: text,
        revisitedAt: new Date(),
        providerName: providerName || grade.providerName || "computed",
      },
    });
    revisited += 1;
  }

  return { seasonId, revisited, skipped };
}

/**
 * Run generate + revisit for every COMPLETE season that has a draft, so a
 * single call backfills both grades for all past seasons.
 *
 * `backfillMissingCommentary` re-runs a season whose grades exist but carry no
 * prose. Grades created before the AI rationale was wired up (or by the seed)
 * have a letter and an empty rationale, and plain generate-once-reuse skips
 * them forever — which is why the Sleeper seasons showed report cards with no
 * commentary while the freshly imported ESPN seasons had it. Only seasons that
 * are actually missing text are re-run, so seasons with good copy are neither
 * rewritten nor re-paid for.
 */
export async function ensureAllPastSeasonsGraded(
  options: { backfillMissingCommentary?: boolean } = {},
): Promise<{
  seasons: number;
  generated: number;
  revisited: number;
  backfilledSeasons: number[];
}> {
  const seasons = await prisma.season.findMany({
    where: { status: "COMPLETE", drafts: { some: {} } },
    select: { id: true, year: true },
    orderBy: { year: "asc" },
  });

  let generated = 0;
  let revisited = 0;
  const backfilledSeasons: number[] = [];

  for (const season of seasons) {
    let forceOriginal = false;
    let forceRevisit = false;

    if (options.backfillMissingCommentary) {
      const [missingOriginal, missingRevisit] = await Promise.all([
        prisma.draftGrade.count({
          where: { seasonId: season.id, OR: [{ rationale: null }, { rationale: "" }] },
        }),
        prisma.draftGrade.count({
          where: {
            seasonId: season.id,
            OR: [{ revisitedRationale: null }, { revisitedRationale: "" }, { revisitedAt: null }],
          },
        }),
      ]);
      forceOriginal = missingOriginal > 0;
      forceRevisit = missingRevisit > 0;
      if (forceOriginal || forceRevisit) backfilledSeasons.push(season.year);
    }

    const gen = await generateDraftGradesForSeason(season.id, { force: forceOriginal });
    generated += gen.created;
    const rev = await revisitDraftGradesForSeason(season.id, { force: forceRevisit });
    revisited += rev.revisited;
  }

  return { seasons: seasons.length, generated, revisited, backfilledSeasons };
}

// ---------------------------------------------------------------------------
// Read side (for the page)
// ---------------------------------------------------------------------------

export interface DraftReportCard {
  managerId: string;
  managerName: string;
  avatarUrl: string | null;
  grade: GradeLetter | null;
  rationale: string | null;
  /** 0-100 composite behind the original grade. */
  score: number | null;
  factors: DraftFactor[];
  revisitedGrade: GradeLetter | null;
  revisitedRationale: string | null;
  /**
   * How much of this team's draft board could actually be measured. LOW means
   * the grade rests on inputs the data does not fully support, and the card
   * says which ones.
   */
  confidence: DraftConfidence;
  /** Plain-English reasons the confidence is not HIGH. */
  confidenceReasons: string[];
  /** Picks with no player attached — a blank slot on the board. */
  unresolvedPicks: number;
  pickCount: number;
}

export type DraftConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface DraftReportCardsView {
  seasonYear: number | null;
  seasonId: string | null;
  status: "UPCOMING" | "IN_PROGRESS" | "COMPLETE" | null;
  cards: DraftReportCard[];
  /** Weights behind the original grade, for the methodology panel. */
  weights: { key: string; label: string; description: string; weight: number }[];
  /** True when average draft position was available for this season. */
  adpAvailable: boolean;
  /** Weights behind the revisited grade. */
  revisitWeights: { key: string; label: string; description: string; weight: number }[];
  /** False when the season has no per-player scoring, so no revisited grade exists. */
  revisitAvailable: boolean;
  /** Season-wide confidence, and what is missing behind it. */
  confidence: DraftConfidence;
  confidenceReasons: string[];
}

/**
 * Report cards for one season's draft. Defaults to the latest season that has a
 * draft. Returns season metadata alongside the cards so the page can show the
 * selector state and decide whether to surface revisited grades.
 */
export async function getDraftReportCards(seasonYear?: number): Promise<DraftReportCardsView> {
  const season = seasonYear
    ? await prisma.season.findFirst({
        where: { year: seasonYear, drafts: { some: {} } },
        select: { id: true, year: true, status: true },
      })
    : // Default to the latest season that actually has grades, so we don't land
      // on an ungraded upcoming/pre-draft season.
      (await prisma.season.findFirst({
        where: { draftGrades: { some: {} } },
        orderBy: { year: "desc" },
        select: { id: true, year: true, status: true },
      })) ??
      (await prisma.season.findFirst({
        where: { drafts: { some: {} } },
        orderBy: { year: "desc" },
        select: { id: true, year: true, status: true },
      }));

  if (!season) {
    return {
      seasonYear: seasonYear ?? null,
      seasonId: null,
      status: null,
      cards: [],
      weights: [],
      adpAvailable: false,
      revisitWeights: [],
      revisitAvailable: false,
      confidence: "LOW",
      confidenceReasons: ["No draft is on record for this season."],
    };
  }

  const grades = await prisma.draftGrade.findMany({
    where: { seasonId: season.id },
    include: { manager: { select: { displayName: true, photoUrl: true, avatarUrl: true } } },
    // Best draft first — the point of a report card is the ranking.
    orderBy: [{ originalScore: "desc" }, { manager: { displayName: "asc" } }],
  });

  const adpAvailable = grades.some((g) => g.adpAvailable);

  /*
   * The methodology panel reads its weights from the factors actually STORED
   * against the grades, not from the static weight table.
   *
   * It used to rebuild the list itself and only knew how to drop the ADP
   * factor, so when bye-week spread and risk concentration were also dropped
   * the panel advertised seven factors at 27/22/16/14/11/5/5 while every card
   * below it showed five at 30/24/18/15/12. Two different sets of weights on
   * one page, both claiming to be the ones used. Deriving from the stored
   * breakdown makes disagreement impossible.
   */
  const storedFactors =
    grades
      .map((g) =>
        Array.isArray(g.originalFactors) ? (g.originalFactors as unknown as DraftFactor[]) : null,
      )
      .find((f): f is DraftFactor[] => f != null && f.length > 0) ?? null;

  const activeKeys: DraftFactorKey[] = storedFactors
    ? storedFactors.map((f) => f.key)
    : (Object.keys(DRAFT_WEIGHTS) as DraftFactorKey[]).filter((k) =>
        k === "valueVsAdp" ? adpAvailable : true,
      );
  const weightByKey = new Map<DraftFactorKey, number>(
    storedFactors ? storedFactors.map((f) => [f.key, f.weight]) : [],
  );
  const weightTotal = activeKeys.reduce((sum, k) => sum + DRAFT_WEIGHTS[k], 0);

  /*
   * How well the recorded data actually supports these grades, per team and
   * for the season. A grade with a blank pick behind it, or with no prior
   * production for the players drafted, is worth less than one where every
   * pick resolved — and the page should say so rather than printing a letter
   * with the same authority either way.
   */
  const picks = await prisma.draftPick.findMany({
    where: { draft: { seasonId: season.id } },
    select: { managerId: true, playerId: true },
  });
  const priorPercentile = await buildPriorPositionalPercentiles(season.year);
  const perManager = new Map<string, { total: number; blank: number; rated: number }>();
  for (const pick of picks) {
    if (!pick.managerId) continue;
    const cur = perManager.get(pick.managerId) ?? { total: 0, blank: 0, rated: 0 };
    cur.total += 1;
    if (!pick.playerId) cur.blank += 1;
    else if (priorPercentile.has(pick.playerId)) cur.rated += 1;
    perManager.set(pick.managerId, cur);
  }

  const confidenceFor = (
    managerId: string,
  ): { confidence: DraftConfidence; reasons: string[]; blank: number; total: number } => {
    const stats = perManager.get(managerId) ?? { total: 0, blank: 0, rated: 0 };
    const reasons: string[] = [];
    if (stats.total === 0) {
      return { confidence: "LOW", reasons: ["No picks are on record for this manager."], blank: 0, total: 0 };
    }
    if (stats.blank > 0) {
      reasons.push(
        `${stats.blank} of ${stats.total} picks have no player attached, so those slots could not be graded`,
      );
    }
    const ratedShare = stats.rated / stats.total;
    if (ratedShare < 0.3) {
      reasons.push(
        "almost none of the players drafted have a prior season on record, so starter quality falls back to where they were taken",
      );
    } else if (ratedShare < 0.7) {
      reasons.push(
        `only ${Math.round(ratedShare * 100)}% of the players drafted have a prior season on record`,
      );
    }
    if (!adpAvailable) {
      reasons.push("no average draft position is on record for this season");
    }
    const confidence: DraftConfidence =
      stats.blank > 0 || ratedShare < 0.3 ? "LOW" : reasons.length > 0 ? "MEDIUM" : "HIGH";
    return { confidence, reasons, blank: stats.blank, total: stats.total };
  };

  const perCardConfidence = new Map(grades.map((g) => [g.managerId, confidenceFor(g.managerId)]));
  const worst: DraftConfidence = [...perCardConfidence.values()].some((c) => c.confidence === "LOW")
    ? "LOW"
    : [...perCardConfidence.values()].some((c) => c.confidence === "MEDIUM")
      ? "MEDIUM"
      : "HIGH";
  const seasonReasons = [
    ...new Set([...perCardConfidence.values()].flatMap((c) => c.reasons)),
  ];

  return {
    seasonYear: season.year,
    seasonId: season.id,
    status: season.status,
    adpAvailable,
    // A revisited grade exists only where per-player weekly scoring does.
    revisitAvailable: grades.some((g) => g.revisitedGrade != null),
    revisitWeights: (Object.keys(RETURN_WEIGHTS) as ReturnFactorKey[]).map((key) => ({
      key,
      label: RETURN_FACTOR_META[key].label,
      description: RETURN_FACTOR_META[key].description,
      weight: RETURN_WEIGHTS[key],
    })),
    weights: activeKeys.map((key) => ({
      key,
      label: DRAFT_FACTOR_META[key].label,
      description: DRAFT_FACTOR_META[key].description,
      weight: weightByKey.get(key) ?? DRAFT_WEIGHTS[key] / weightTotal,
    })),
    confidence: worst,
    confidenceReasons: seasonReasons,
    cards: grades.map((g) => {
      const c = perCardConfidence.get(g.managerId);
      return {
        managerId: g.managerId,
        managerName: g.manager.displayName,
        avatarUrl: g.manager.photoUrl ?? g.manager.avatarUrl,
        grade: g.grade,
        rationale: g.rationale,
        score: g.originalScore,
        factors: Array.isArray(g.originalFactors)
          ? (g.originalFactors as unknown as DraftFactor[])
          : [],
        revisitedGrade: g.revisitedGrade,
        revisitedRationale: g.revisitedRationale,
        confidence: c?.confidence ?? "LOW",
        confidenceReasons: c?.reasons ?? [],
        unresolvedPicks: c?.blank ?? 0,
        pickCount: c?.total ?? 0,
      };
    }),
  };
}

/** Years that have draft grades, newest first — for the season selector. */
export async function listGradedSeasons(): Promise<{ year: number }[]> {
  return prisma.season.findMany({
    where: { draftGrades: { some: {} } },
    orderBy: { year: "desc" },
    select: { year: true },
  });
}
