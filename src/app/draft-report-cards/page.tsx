import { renderAtRequestIfNoDatabase } from "@/server/build-guard";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { draftRevisitTexts } from "@/server/text/page-texts";
import type { RenderedText } from "@/server/text/read";
import {
  getDraftReportCards,
  listGradedSeasons,
  loadDraftReturns,
  loadPickReturns,
  gradeLetterToDisplay,
} from "@/server/repositories/draft-grade-repository";
import { getDraftBoard, listDraftSeasons } from "@/server/repositories/draft-repository";
import { getPowerRankings } from "@/server/repositories/power-rankings-repository";
import { teamColorMap } from "@/lib/chart-theme";
import { DraftSeasonPicker, DraftTabs, parseDraftTab } from "@/components/drafts/draft-tabs";
import { DraftBoard, type BoardView } from "@/components/drafts/draft-board";
import { GradesTab } from "@/components/drafts/grades-tab";
import { RevisitedTab, type GradeVsRealityChart } from "@/components/drafts/revisited-tab";
import { LAST_ESPN_SEASON } from "@/components/drafts/grade-ui";
import { ClipboardList } from "lucide-react";

export const metadata = { title: "Drafts & Report Cards" };

/**
 * One page for everything about the draft — /drafts redirects here.
 *
 *   ?tab=board      the board itself, team columns x rounds, optionally
 *                   coloured by hindsight (Sleeper seasons)
 *   ?tab=grades     the draft-day report cards (the default: this is the
 *                   Draft Report Cards page every existing link points at)
 *   ?tab=revisited  the hindsight grade and its commentary
 *
 * `season` picks the year; `view=hindsight` switches the board colouring.
 */
export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; tab?: string; view?: string }>;
}) {
  await renderAtRequestIfNoDatabase();
  const params = await searchParams;
  const tab = parseDraftTab(params.tab);
  const boardView: BoardView = params.view === "hindsight" ? "hindsight" : "position";

  const [graded, drafted] = await Promise.all([listGradedSeasons(), listDraftSeasons()]);
  const years = [...new Set([...graded.map((s) => s.year), ...drafted.map((s) => s.year)])].sort((a, b) => b - a);
  const requested = params.season ? Number(params.season) : NaN;
  // Default: the latest season with grades, as the report cards always did.
  const year = Number.isFinite(requested) ? requested : (graded[0]?.year ?? drafted[0]?.year ?? null);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        art="header-draft-report-cards"
        freshness
        eyebrow="On the Clock"
        title="Drafts"
        description="Every board, pick by pick; a grade for every draft, judged on the decisions made in the room; and the hindsight verdict on what those picks actually produced."
      />

      <DraftTabs active={tab} season={year} />
      <DraftSeasonPicker years={years} active={year} tab={tab} view={tab === "board" ? boardView : undefined} />

      {tab === "board" ? (
        <BoardSection year={year} view={boardView} />
      ) : (
        <GradesSections tab={tab} year={year} />
      )}
    </div>
  );
}

async function BoardSection({ year, view }: { year: number | null; view: BoardView }) {
  const board = year != null ? await getDraftBoard(year) : null;
  if (!board) {
    return (
      <div className="mt-8">
        <EmptyState icon={ClipboardList} title="No draft recorded for this season yet" />
      </div>
    );
  }

  const isSleeper = board.dataSource === "SLEEPER";
  const hindsight = isSleeper ? await loadPickReturns(board.seasonId) : null;
  const hindsightNote = hindsight
    ? null
    : board.seasonYear <= LAST_ESPN_SEASON || !isSleeper
      ? "Steal-or-bust colouring needs per-player weekly scoring, which ESPN did not keep for its archived seasons (2017-2022), so this board is coloured by position only."
      : `Steal-or-bust colouring appears once the ${board.seasonYear} season has player scoring on record.`;

  return <DraftBoard board={board} view={view} hindsight={hindsight} hindsightNote={hindsightNote} />;
}

async function GradesSections({ tab, year }: { tab: "grades" | "revisited"; year: number | null }) {
  const view = await getDraftReportCards(year ?? undefined);
  const revisitTexts: Map<string, RenderedText> = view.provisionalRevisit
    ? await draftRevisitTexts()
    : new Map();

  if (tab === "grades") return <GradesTab view={view} revisitTexts={revisitTexts} />;

  const [returns, chartResult] = await Promise.all([
    view.seasonId && view.revisitAvailable ? loadDraftReturns(view.seasonId) : Promise.resolve(null),
    gradeVsReality(view),
  ]);

  return (
    <RevisitedTab
      view={view}
      revisitTexts={revisitTexts}
      returns={returns?.available ? returns : null}
      chart={chartResult.chart}
      chartNote={chartResult.note}
    />
  );
}

/**
 * Draft-day score against this week's power score, for the season in
 * progress. Only once games have been played: the preseason power score is
 * itself built from the drafted rosters, so plotting it against the draft
 * grade would only show the draft grade agreeing with itself.
 */
async function gradeVsReality(
  view: Awaited<ReturnType<typeof getDraftReportCards>>,
): Promise<{ chart: GradeVsRealityChart | null; note: string | null }> {
  const rankings = await getPowerRankings();
  if (!rankings || view.seasonYear == null) return { chart: null, note: null };
  if (rankings.seasonYear !== view.seasonYear) {
    return {
      chart: null,
      note: `The draft-grade-vs-reality chart follows the season being played — pick ${rankings.seasonYear} to see it.`,
    };
  }
  if (rankings.mode !== "IN_SEASON") {
    return {
      chart: null,
      note: "The draft-grade-vs-reality chart appears once Week 1 is final: until then the power score is built from the drafted rosters themselves.",
    };
  }

  const managers = await prisma.manager.findMany({ select: { id: true } });
  const colors = teamColorMap(managers.map((m) => m.id));
  const byManager = new Map(rankings.rows.filter((r) => r.managerId).map((r) => [r.managerId as string, r]));

  const rows: GradeVsRealityChart["rows"] = [];
  const points: GradeVsRealityChart["points"] = [];
  for (const card of view.cards) {
    const power = byManager.get(card.managerId);
    if (card.score == null || !power) continue;
    const grade = gradeLetterToDisplay(card.grade);
    rows.push({
      manager: card.managerName,
      draftScore: card.score,
      grade,
      powerScore: power.score,
      powerRank: power.rank,
    });
    points.push({
      x: card.score,
      y: power.score,
      label: card.managerName.length > 14 ? `${card.managerName.slice(0, 13)}…` : card.managerName,
      color: colors.get(card.managerId) ?? "var(--primary)",
      detail: `Draft grade ${grade} · power rank #${power.rank} (${power.teamName})`,
    });
  }
  if (points.length < 2) return { chart: null, note: null };
  return { chart: { points, rows, throughWeek: rankings.throughWeek }, note: null };
}
