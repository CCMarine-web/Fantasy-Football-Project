import { prisma } from "@/lib/db";
import { LEAGUE_CONFIG } from "@/lib/league-config";
import type { Prediction, Season } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Prophet Rating — scoring weights
// ---------------------------------------------------------------------------
//
// A prediction is scored against the actual season results. Every prediction
// earns a single total ("Prophet Rating"); higher is better. Breakdown:
//
//   CHAMPION      +25  predicted champion === actual champion
//   LAST_PLACE    +15  predicted last === actual last-place finisher
//   STANDINGS_HIT  +3  per manager placed in EXACTLY the right final position
//                      (predicted standings array compared slot-by-slot to the
//                      actual final order, both 1st..last)
//   BUST          +10  predicted "bust" manager finished in the BOTTOM HALF of
//                      the final standings. We have no preseason projections in
//                      the DB, so "bust" is scored as a data-driven heuristic:
//                      picking anyone who ends up in the lower half counts.
//   OWN_RECORD  0..+10  closeness of predicted own win total to actual wins:
//                      max(0, 10 - 2.5 * |predictedWins - actualWins|).
//                      (Losses are complementary, so wins alone captures it.)
//
// Totals are summed and the list is ranked descending. For an IN_PROGRESS
// season the "actual" order/record is the current state, so the leaderboard is
// a live standing; for COMPLETE seasons it is final.
// ---------------------------------------------------------------------------
export const PROPHET_WEIGHTS = {
  CHAMPION: 25,
  LAST_PLACE: 15,
  STANDINGS_HIT: 3,
  BUST: 10,
  OWN_RECORD_MAX: 10,
  OWN_RECORD_PENALTY_PER_WIN: 2.5,
} as const;

// ---------------------------------------------------------------------------
// Season selection + deadline
// ---------------------------------------------------------------------------

export interface PredictionSeasonInfo {
  season: Season;
  /** The moment predictions lock (defaults to the league draft time). */
  deadline: Date;
  /** True once the deadline has passed — predictions can no longer be edited. */
  locked: boolean;
}

function predictionDeadline(): Date {
  return new Date(LEAGUE_CONFIG.draftDate);
}

/**
 * The season that predictions are FOR: the current (isCurrent) UPCOMING or
 * IN_PROGRESS season, else the most recent season overall. Returns the season
 * plus whether the LEAGUE_CONFIG.draftDate deadline has already passed.
 */
export async function getPredictionSeason(): Promise<PredictionSeasonInfo | null> {
  let season = await prisma.season.findFirst({
    where: { isCurrent: true, status: { in: ["UPCOMING", "IN_PROGRESS"] } },
    orderBy: { year: "desc" },
  });
  if (!season) {
    season = await prisma.season.findFirst({ orderBy: { year: "desc" } });
  }
  if (!season) return null;

  const deadline = predictionDeadline();
  return { season, deadline, locked: Date.now() >= deadline.getTime() };
}

// ---------------------------------------------------------------------------
// Read / write a single prediction
// ---------------------------------------------------------------------------

export async function getMyPrediction(
  managerId: string,
  seasonId: string,
): Promise<Prediction | null> {
  return prisma.prediction.findUnique({
    where: { seasonId_managerId: { seasonId, managerId } },
  });
}

export interface UpsertPredictionInput {
  seasonId: string;
  managerId: string;
  userId?: string | null;
  predictedStandings: string[];
  predictedChampionManagerId?: string | null;
  predictedLastManagerId?: string | null;
  predictedOwnWins?: number | null;
  predictedOwnLosses?: number | null;
  bustManagerId?: string | null;
  boldTake?: string | null;
  /** Admin backfill: bypass the deadline lock. */
  adminOverride?: boolean;
}

/**
 * Create or update the prediction for (seasonId, managerId). Throws if the
 * deadline has passed unless `adminOverride` is set. Admin-entered predictions
 * are stored `locked: true` (they are historical backfills).
 */
export async function upsertPrediction(input: UpsertPredictionInput): Promise<void> {
  if (!input.adminOverride && Date.now() >= predictionDeadline().getTime()) {
    throw new Error("Predictions are locked — the deadline has passed.");
  }

  const data = {
    userId: input.userId ?? null,
    predictedStandings: input.predictedStandings,
    predictedChampionManagerId: input.predictedChampionManagerId ?? null,
    predictedLastManagerId: input.predictedLastManagerId ?? null,
    predictedOwnWins: input.predictedOwnWins ?? null,
    predictedOwnLosses: input.predictedOwnLosses ?? null,
    bustManagerId: input.bustManagerId ?? null,
    boldTake: input.boldTake ?? null,
    locked: input.adminOverride === true,
  };

  await prisma.prediction.upsert({
    where: { seasonId_managerId: { seasonId: input.seasonId, managerId: input.managerId } },
    update: data,
    create: {
      seasonId: input.seasonId,
      managerId: input.managerId,
      ...data,
    },
  });
}

// ---------------------------------------------------------------------------
// List predictions for display
// ---------------------------------------------------------------------------

export interface PredictionView {
  id: string;
  managerId: string;
  managerName: string;
  managerAvatarUrl: string | null;
  /** Predicted final order 1st..last, as manager display names. */
  predictedStandingsNames: string[];
  championName: string | null;
  lastName: string | null;
  bustName: string | null;
  predictedOwnWins: number | null;
  predictedOwnLosses: number | null;
  boldTake: string | null;
  submittedAt: Date;
}

async function managerNameMap(): Promise<Map<string, { name: string; avatarUrl: string | null }>> {
  const managers = await prisma.manager.findMany({
    select: { id: true, displayName: true, photoUrl: true, avatarUrl: true },
  });
  return new Map(managers.map((m) => [m.id, { name: m.displayName, avatarUrl: m.photoUrl ?? m.avatarUrl }]));
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Everyone's predictions for a season, with names resolved for display. */
export async function listPredictions(seasonId: string): Promise<PredictionView[]> {
  const [rows, names] = await Promise.all([
    prisma.prediction.findMany({
      where: { seasonId },
      include: { manager: { select: { id: true, displayName: true, photoUrl: true, avatarUrl: true } } },
      orderBy: { submittedAt: "asc" },
    }),
    managerNameMap(),
  ]);

  const nameOf = (id: string | null): string | null => (id ? names.get(id)?.name ?? null : null);

  return rows.map((p) => ({
    id: p.id,
    managerId: p.managerId,
    managerName: p.manager.displayName,
    managerAvatarUrl: p.manager.photoUrl ?? p.manager.avatarUrl,
    predictedStandingsNames: toStringArray(p.predictedStandings).map(
      (id) => names.get(id)?.name ?? "—",
    ),
    championName: nameOf(p.predictedChampionManagerId),
    lastName: nameOf(p.predictedLastManagerId),
    bustName: nameOf(p.bustManagerId),
    predictedOwnWins: p.predictedOwnWins,
    predictedOwnLosses: p.predictedOwnLosses,
    boldTake: p.boldTake,
    submittedAt: p.submittedAt,
  }));
}

// ---------------------------------------------------------------------------
// Scoring — Prophet Rating
// ---------------------------------------------------------------------------

interface ActualResults {
  /** Manager ids in final order, 1st..last. */
  order: string[];
  championManagerId: string | null;
  lastManagerId: string | null;
  /** managerId -> actual wins. */
  winsByManager: Map<string, number>;
  teamCount: number;
}

/**
 * Actual results for a season, robust to in-progress data: teams are ordered by
 * finalRank when set, otherwise by wins (desc) then points-for (desc).
 */
async function getActualResults(seasonId: string): Promise<ActualResults | null> {
  const teams = await prisma.fantasyTeam.findMany({
    where: { seasonId },
    select: {
      managerId: true,
      wins: true,
      losses: true,
      pointsFor: true,
      finalRank: true,
      isChampion: true,
    },
  });
  if (teams.length === 0) return null;

  const sorted = [...teams].sort((a, b) => {
    if (a.finalRank != null && b.finalRank != null) return a.finalRank - b.finalRank;
    if (a.finalRank != null) return -1;
    if (b.finalRank != null) return 1;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.pointsFor - a.pointsFor;
  });

  const order = sorted.map((t) => t.managerId);
  const winsByManager = new Map(teams.map((t) => [t.managerId, t.wins]));

  const champ = await prisma.championship.findUnique({
    where: { seasonId },
    select: { championManagerId: true },
  });
  const championManagerId =
    champ?.championManagerId ?? teams.find((t) => t.isChampion)?.managerId ?? order[0] ?? null;

  return {
    order,
    championManagerId,
    lastManagerId: order.length > 0 ? order[order.length - 1] : null,
    winsByManager,
    teamCount: teams.length,
  };
}

export interface PredictionScore {
  managerId: string;
  managerName: string;
  managerAvatarUrl: string | null;
  championPoints: number;
  lastPoints: number;
  standingsPoints: number;
  standingsHits: number;
  bustPoints: number;
  ownRecordPoints: number;
  total: number;
}

function scoreOne(
  prediction: {
    predictedStandings: unknown;
    predictedChampionManagerId: string | null;
    predictedLastManagerId: string | null;
    predictedOwnWins: number | null;
    bustManagerId: string | null;
    managerId: string;
  },
  actual: ActualResults,
): Omit<PredictionScore, "managerName" | "managerAvatarUrl"> {
  const W = PROPHET_WEIGHTS;

  const championPoints =
    prediction.predictedChampionManagerId &&
    prediction.predictedChampionManagerId === actual.championManagerId
      ? W.CHAMPION
      : 0;

  const lastPoints =
    prediction.predictedLastManagerId &&
    prediction.predictedLastManagerId === actual.lastManagerId
      ? W.LAST_PLACE
      : 0;

  const predictedOrder = toStringArray(prediction.predictedStandings);
  let standingsHits = 0;
  for (let i = 0; i < predictedOrder.length; i++) {
    if (actual.order[i] && predictedOrder[i] === actual.order[i]) standingsHits++;
  }
  const standingsPoints = standingsHits * W.STANDINGS_HIT;

  // Bottom half of the standings (managers ranked in the lower half count as busts).
  const bottomHalf = new Set(actual.order.slice(Math.ceil(actual.teamCount / 2)));
  const bustPoints =
    prediction.bustManagerId && bottomHalf.has(prediction.bustManagerId) ? W.BUST : 0;

  let ownRecordPoints = 0;
  if (prediction.predictedOwnWins != null) {
    const actualWins = actual.winsByManager.get(prediction.managerId);
    if (actualWins != null) {
      const diff = Math.abs(prediction.predictedOwnWins - actualWins);
      ownRecordPoints = Math.max(0, W.OWN_RECORD_MAX - W.OWN_RECORD_PENALTY_PER_WIN * diff);
    }
  }

  const total =
    championPoints + lastPoints + standingsPoints + bustPoints + ownRecordPoints;

  return {
    managerId: prediction.managerId,
    championPoints,
    lastPoints,
    standingsPoints,
    standingsHits,
    bustPoints,
    ownRecordPoints,
    total,
  };
}

/**
 * Score every prediction for a season against actual results, ranked by total
 * Prophet Rating (descending). Returns [] if there are no results to score
 * against yet (e.g. an UPCOMING season with no games played).
 */
export async function scorePredictions(seasonId: string): Promise<PredictionScore[]> {
  const [predictions, actual] = await Promise.all([
    prisma.prediction.findMany({
      where: { seasonId },
      include: { manager: { select: { displayName: true, photoUrl: true, avatarUrl: true } } },
    }),
    getActualResults(seasonId),
  ]);

  if (!actual || predictions.length === 0) return [];

  const scored = predictions.map((p) => {
    const base = scoreOne(p, actual);
    return {
      ...base,
      managerName: p.manager.displayName,
      managerAvatarUrl: p.manager.photoUrl ?? p.manager.avatarUrl,
    } satisfies PredictionScore;
  });

  scored.sort((a, b) => b.total - a.total || a.managerName.localeCompare(b.managerName));
  return scored;
}

// ---------------------------------------------------------------------------
// Career accuracy — aggregate Prophet Rating across scored seasons
// ---------------------------------------------------------------------------

export interface CareerAccuracy {
  managerId: string;
  managerName: string;
  managerAvatarUrl: string | null;
  seasonsScored: number;
  totalRating: number;
  averageRating: number;
}

/**
 * Aggregate each manager's Prophet Rating across all COMPLETE seasons that have
 * predictions, ranked by total career rating (descending).
 */
export async function getCareerPredictionAccuracy(): Promise<CareerAccuracy[]> {
  const seasons = await prisma.season.findMany({
    where: { status: "COMPLETE", predictions: { some: {} } },
    select: { id: true },
  });

  const agg = new Map<
    string,
    { name: string; avatarUrl: string | null; total: number; seasons: number }
  >();

  for (const s of seasons) {
    const scores = await scorePredictions(s.id);
    for (const sc of scores) {
      const cur = agg.get(sc.managerId) ?? {
        name: sc.managerName,
        avatarUrl: sc.managerAvatarUrl,
        total: 0,
        seasons: 0,
      };
      cur.total += sc.total;
      cur.seasons += 1;
      agg.set(sc.managerId, cur);
    }
  }

  const result = Array.from(agg.entries()).map(([managerId, v]) => ({
    managerId,
    managerName: v.name,
    managerAvatarUrl: v.avatarUrl,
    seasonsScored: v.seasons,
    totalRating: v.total,
    averageRating: v.seasons > 0 ? v.total / v.seasons : 0,
  }));

  result.sort((a, b) => b.totalRating - a.totalRating || a.managerName.localeCompare(b.managerName));
  return result;
}

// ---------------------------------------------------------------------------
// Managers for the prediction form selects
// ---------------------------------------------------------------------------

export interface PredictionManagerOption {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Active managers to populate the standings / champion / last / bust selects. */
export async function listManagersForPredictionForm(): Promise<PredictionManagerOption[]> {
  const managers = await prisma.manager.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, displayName: true, photoUrl: true, avatarUrl: true },
    orderBy: { displayName: "asc" },
  });
  return managers.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    avatarUrl: m.photoUrl ?? m.avatarUrl,
  }));
}
