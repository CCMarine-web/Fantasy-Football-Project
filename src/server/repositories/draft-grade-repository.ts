// Draft report-card persistence + the deterministic grade heuristics.
//
// Design point: the LETTER grade is derived here, deterministically, from
// outcome signals — so grades are meaningful even when the AI runs on the mock
// provider (no OPENAI_API_KEY). The AI (draft-grade.ts) only writes the prose
// RATIONALE. Grades are generate-once-reuse: once a manager has a grade for a
// season we skip it on re-runs unless `force` is passed, so the weekly pipeline
// can call these repeatedly without regenerating (or paying for) existing grades.

import { prisma } from "@/lib/db";
import { GradeLetter } from "@/generated/prisma/client";
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
 * ORIGINAL (draft-day) grade heuristic.
 *
 * At draft time the only signal available is the picks themselves — there is
 * no outcome to grade against — so we keep this deliberately light and
 * neutral, as the spec allows. Everyone starts around B+/B:
 *   - No players actually drafted (all slots empty / data gap) -> C.
 *   - Heavy keeper reliance (keepers >= half the rounds, i.e. more of the roster
 *     was inherited than freshly drafted) -> B, a touch below the pack.
 *   - Otherwise -> B+.
 * The AI rationale supplies the color; the letter is intentionally modest until
 * the season revisits it.
 */
export function originalGradeHeuristic({
  totalPicks,
  keepers,
  rounds,
}: {
  totalPicks: number;
  keepers: number;
  rounds: number;
}): GradeLetter {
  if (totalPicks === 0) return GradeLetter.C;
  if (rounds > 0 && keepers >= Math.ceil(rounds / 2)) return GradeLetter.B;
  return GradeLetter.B_PLUS;
}

/**
 * REVISITED (post-season) grade heuristic, derived from actual finish.
 *
 * Mapping (N = teams in the season, r = finalRank, 1 = best):
 *   - Champion .............................. A+
 *   - Runner-up (r = 2) ..................... A
 *   - Made playoffs & top third (r <= ceil(N/3)) .. A-
 *   - Made playoffs, outside top third ..... B+
 *   - Missed playoffs, upper-middle (r <= ceil(N/2)) .. B
 *   - Missed playoffs, lower-middle ........ C+
 *   - Bottom third (r >= floor(2N/3)+1), not last two .. C
 *   - Bottom third, second-to-last .......... D
 *   - Last (r = N) .......................... F
 * finalRank/teamCount missing degrades gracefully (unknown finish treated as last).
 */
export function letterFromFinish({
  isChampion,
  madePlayoffs,
  finalRank,
  teamCount,
}: {
  isChampion: boolean;
  madePlayoffs: boolean;
  finalRank: number | null | undefined;
  teamCount: number;
}): GradeLetter {
  if (isChampion) return GradeLetter.A_PLUS;

  const N = teamCount > 0 ? teamCount : 12;
  const r = finalRank && finalRank > 0 ? finalRank : N;

  if (r === 1) return GradeLetter.A_PLUS; // champion flag missing but finished first
  if (r === 2) return GradeLetter.A;

  const topThird = Math.max(1, Math.ceil(N / 3));
  const bottomThirdStart = Math.floor((2 * N) / 3) + 1;

  if (madePlayoffs && r <= topThird) return GradeLetter.A_MINUS;
  if (madePlayoffs) return GradeLetter.B_PLUS;

  if (r === N) return GradeLetter.F;
  if (r >= bottomThirdStart) return r >= N - 1 ? GradeLetter.D : GradeLetter.C;

  if (r <= Math.ceil(N / 2)) return GradeLetter.B;
  return GradeLetter.C_PLUS;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function pickLine(pick: {
  round: number;
  isKeeper: boolean;
  player: { firstName: string; lastName: string; position: string; nflTeam: string | null } | null;
}): string {
  const name = pick.player
    ? `${pick.player.firstName} ${pick.player.lastName} (${pick.player.position}${
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
  const byManager = new Map<string, { managerName: string; picks: typeof draft.picks }>();
  for (const pick of draft.picks) {
    if (!pick.managerId) continue;
    const entry = byManager.get(pick.managerId) ?? {
      managerName: pick.manager?.displayName ?? "Unknown Manager",
      picks: [] as typeof draft.picks,
    };
    entry.picks.push(pick);
    byManager.set(pick.managerId, entry);
  }

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

    const totalPicks = picks.filter((p) => p.player).length;
    const keepers = picks.filter((p) => p.isKeeper).length;
    const grade = originalGradeHeuristic({ totalPicks, keepers, rounds: draft.rounds });

    const { text, providerName } = await generateDraftRationale(
      {
        seasonYear,
        managerName,
        derivedGrade: gradeLetterToDisplay(grade),
        totalPicks,
        keepers,
        rounds: draft.rounds,
        picks: picks.map(pickLine),
      },
      safeguards
    );

    await prisma.draftGrade.upsert({
      where: { seasonId_managerId: { seasonId, managerId } },
      create: {
        seasonId,
        managerId,
        grade,
        rationale: text,
        providerName: providerName || "heuristic",
      },
      update: {
        grade,
        rationale: text,
        providerName: providerName || "heuristic",
        generatedAt: new Date(),
      },
    });
    created += 1;
  }

  return { seasonId, created, skipped };
}

export interface RevisitGradesResult {
  seasonId: string;
  revisited: number;
  skipped: number;
}

/**
 * Recompute REVISITED grades from actual finish, for COMPLETE seasons only.
 * Skips grades already revisited unless `force`. Exported so it can be wired
 * into the weekly pipeline (it becomes a no-op until the season completes).
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

  const [grades, teams] = await Promise.all([
    prisma.draftGrade.findMany({
      where: { seasonId },
      include: { manager: { select: { displayName: true } } },
    }),
    prisma.fantasyTeam.findMany({
      where: { seasonId },
      select: {
        managerId: true,
        teamName: true,
        wins: true,
        losses: true,
        ties: true,
        pointsFor: true,
        regularSeasonRank: true,
        finalRank: true,
        madePlayoffs: true,
        isChampion: true,
      },
    }),
  ]);

  const teamCount = teams.length;
  const teamByManager = new Map(teams.map((t) => [t.managerId, t]));
  const safeguards = await getContentSafeguards();

  let revisited = 0;
  let skipped = 0;

  for (const grade of grades) {
    if (grade.revisitedAt && !options.force) {
      skipped += 1;
      continue;
    }
    const team = teamByManager.get(grade.managerId);
    if (!team) {
      skipped += 1;
      continue;
    }

    const revisitedGrade = letterFromFinish({
      isChampion: team.isChampion,
      madePlayoffs: team.madePlayoffs,
      finalRank: team.finalRank,
      teamCount,
    });

    const record = `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ""}`;

    const { text, providerName } = await generateDraftRevisitRationale(
      {
        seasonYear: season.year,
        managerName: grade.manager.displayName,
        teamName: team.teamName,
        originalGrade: gradeLetterToDisplay(grade.grade),
        originalRationale: grade.rationale ?? undefined,
        revisitedGrade: gradeLetterToDisplay(revisitedGrade),
        finish: {
          record,
          pointsFor: team.pointsFor,
          regularSeasonRank: team.regularSeasonRank,
          finalRank: team.finalRank,
          madePlayoffs: team.madePlayoffs,
          isChampion: team.isChampion,
        },
      },
      safeguards
    );

    await prisma.draftGrade.update({
      where: { id: grade.id },
      data: {
        revisitedGrade,
        revisitedRationale: text,
        revisitedAt: new Date(),
        providerName: providerName || grade.providerName || "heuristic",
      },
    });
    revisited += 1;
  }

  return { seasonId, revisited, skipped };
}

/**
 * Run generate + revisit for every COMPLETE season that has a draft, so a
 * single call backfills both grades for all past seasons.
 */
export async function ensureAllPastSeasonsGraded(): Promise<{
  seasons: number;
  generated: number;
  revisited: number;
}> {
  const seasons = await prisma.season.findMany({
    where: { status: "COMPLETE", drafts: { some: {} } },
    select: { id: true },
    orderBy: { year: "asc" },
  });

  let generated = 0;
  let revisited = 0;
  for (const season of seasons) {
    const gen = await generateDraftGradesForSeason(season.id);
    generated += gen.created;
    const rev = await revisitDraftGradesForSeason(season.id);
    revisited += rev.revisited;
  }

  return { seasons: seasons.length, generated, revisited };
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
  revisitedGrade: GradeLetter | null;
  revisitedRationale: string | null;
}

export interface DraftReportCardsView {
  seasonYear: number | null;
  seasonId: string | null;
  status: "UPCOMING" | "IN_PROGRESS" | "COMPLETE" | null;
  cards: DraftReportCard[];
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
    return { seasonYear: seasonYear ?? null, seasonId: null, status: null, cards: [] };
  }

  const grades = await prisma.draftGrade.findMany({
    where: { seasonId: season.id },
    include: { manager: { select: { displayName: true, photoUrl: true, avatarUrl: true } } },
    orderBy: { manager: { displayName: "asc" } },
  });

  return {
    seasonYear: season.year,
    seasonId: season.id,
    status: season.status,
    cards: grades.map((g) => ({
      managerId: g.managerId,
      managerName: g.manager.displayName,
      avatarUrl: g.manager.photoUrl ?? g.manager.avatarUrl,
      grade: g.grade,
      rationale: g.rationale,
      revisitedGrade: g.revisitedGrade,
      revisitedRationale: g.revisitedRationale,
    })),
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
