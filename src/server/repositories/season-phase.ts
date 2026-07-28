import { prisma } from "@/lib/db";
import { LEAGUE_CONFIG } from "@/lib/league-config";

/**
 * Where the current season actually is, so the site stops announcing "Week 1"
 * in July.
 *
 * ── The three states ──────────────────────────────────────────────────────
 *   PRESEASON        The season exists but the draft has not happened. There
 *                    are no rosters, no schedule worth showing, and no
 *                    standings — only the countdown and last year's story.
 *   POST_DRAFT       The draft is done and rosters exist, but no week has been
 *                    played. Now there is something to rank and preview.
 *   IN_SEASON        At least one week has real scores.
 *
 * ── How each is decided ───────────────────────────────────────────────────
 * From recorded data first, configuration second:
 *  - Any matchup in the season with a score means IN_SEASON, and the current
 *    week is the highest week that has one.
 *  - Otherwise, a draft with at least one pick means POST_DRAFT. The draft
 *    DATE is only a fallback for when the draft has happened but has not been
 *    synced yet — a date on a calendar is not evidence that anyone drafted.
 *  - Otherwise PRESEASON.
 */

export type SeasonPhase = "PRESEASON" | "POST_DRAFT" | "IN_SEASON";

export interface SeasonPhaseInfo {
  phase: SeasonPhase;
  year: number;
  /** e.g. "2026 Preseason", "2026 Post-Draft Preseason", "Week 4". */
  label: string;
  /** Only meaningful IN_SEASON; null otherwise, so nothing prints "Week 1" early. */
  currentWeek: number | null;
  /** Picks on record for this season's draft. */
  draftPickCount: number;
  /** The configured draft date, ISO, or null when none is set. */
  draftIso: string | null;
  /** True once the configured draft date has passed. */
  draftDatePassed: boolean;
  /**
   * Milliseconds at the moment this was computed, so the countdown can be
   * rendered with a real starting figure instead of a row of zeros. Read here
   * rather than in the component because calling Date.now() during render is
   * impure and React's lint rule rightly rejects it.
   */
  nowMs: number;
}

export async function getSeasonPhase(seasonId: string, year: number): Promise<SeasonPhaseInfo> {
  const [scored, draft] = await Promise.all([
    prisma.matchup.findFirst({
      where: { seasonId, teams: { some: { score: { not: null } } } },
      orderBy: { week: "desc" },
      select: { week: true },
    }),
    prisma.draft.findFirst({
      where: { seasonId },
      select: { _count: { select: { picks: true } } },
    }),
  ]);

  const draftPickCount = draft?._count.picks ?? 0;
  const draftIso = LEAGUE_CONFIG.draftDate ?? null;
  const nowMs = Date.now();
  const draftDatePassed = draftIso ? nowMs >= new Date(draftIso).getTime() : false;

  if (scored) {
    return {
      phase: "IN_SEASON",
      year,
      label: `Week ${scored.week}`,
      currentWeek: scored.week,
      draftPickCount,
      draftIso,
      draftDatePassed,
      nowMs,
    };
  }

  if (draftPickCount > 0 || draftDatePassed) {
    return {
      phase: "POST_DRAFT",
      year,
      label: `${year} Post-Draft Preseason`,
      currentWeek: null,
      draftPickCount,
      draftIso,
      draftDatePassed,
      nowMs,
    };
  }

  return {
    phase: "PRESEASON",
    year,
    label: `${year} Preseason`,
    currentWeek: null,
    draftPickCount,
    draftIso,
    draftDatePassed,
    nowMs,
  };
}
