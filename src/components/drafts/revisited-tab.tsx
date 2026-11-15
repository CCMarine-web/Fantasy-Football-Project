import Link from "next/link";
import { AiText } from "@/components/shared/ai-text";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { ChartFrame } from "@/components/charts/chart-frame";
import { LabeledScatter, type ScatterPoint } from "@/components/charts/charts";
import type { DraftReportCardsView } from "@/server/repositories/draft-grade-repository";
import type { DraftReturnsResult } from "@/server/stats/draft-returns";
import type { RenderedText } from "@/server/text/read";
import { GRADE_ORDER, GradeChip, LAST_ESPN_SEASON, weightPercents } from "@/components/drafts/grade-ui";
import { ArrowRight, History, Info } from "lucide-react";

export interface GradeVsRealityChart {
  points: ScatterPoint[];
  rows: { manager: string; draftScore: number; grade: string; powerScore: number; powerRank: number }[];
  throughWeek: number;
}

function signed(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
}

/**
 * The Revisited tab: the hindsight grade. For a finished Sleeper season that
 * is the stored revisited grade and its write-up; for the season in progress
 * it is the provisional revisit, recomputed every week from points so far.
 */
export function RevisitedTab({
  view,
  revisitTexts,
  returns,
  chart,
  chartNote,
}: {
  view: DraftReportCardsView;
  revisitTexts: Map<string, RenderedText>;
  /** Per-team best and worst picks from the draft-returns model, when it can be computed. */
  returns: DraftReturnsResult | null;
  chart: GradeVsRealityChart | null;
  /** Why the grade-vs-reality chart is not shown, when it is not. */
  chartNote: string | null;
}) {
  const isComplete = view.status === "COMPLETE";
  const isEspnEra = view.seasonYear != null && view.seasonYear <= LAST_ESPN_SEASON;
  const provisional = view.provisionalRevisit;
  const revisitPercents = weightPercents(view.revisitWeights);
  const returnsByManager = new Map((returns?.teams ?? []).map((t) => [t.managerId, t]));

  const rows = view.cards
    .map((card) => {
      const so = provisional?.grades[card.managerId];
      const grade = so?.grade ?? (isComplete ? card.revisitedGrade : null);
      return { card, so, grade };
    })
    .filter((r) => r.grade != null)
    .sort((a, b) => {
      if (a.so && b.so) return a.so.rank - b.so.rank;
      const byLetter = GRADE_ORDER.indexOf(a.grade!) - GRADE_ORDER.indexOf(b.grade!);
      return byLetter || (b.card.score ?? 0) - (a.card.score ?? 0);
    });

  return (
    <>
      <Card className="mt-6 border-border/60 bg-card/40">
        <CardContent>
          <h2 className="font-heading text-base font-semibold">The revisited grade (hindsight)</h2>
          {view.revisitAvailable ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                A separate, clearly-labelled hindsight grade measuring only what the drafted players went on
                to produce — per game, against the slot each was taken at. It never replaces the draft-day
                grade.{" "}
                {provisional ? (
                  <strong className="text-foreground">
                    {view.seasonYear} is still being played: this grade is provisional, recomputed every week
                    from points scored through Week {provisional.throughWeek}, and becomes final when the
                    season ends.{" "}
                  </strong>
                ) : null}
                Wins, playoff berths and championships are <strong className="text-foreground">not</strong>{" "}
                inputs, so winning the league cannot rescue a bad draft and a title-less season cannot sink a
                good one.
              </p>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {view.revisitWeights.map((w, i) => (
                  <div key={w.key} className="flex gap-2">
                    <dt className="w-10 shrink-0 font-mono text-sm font-semibold tabular-nums text-primary">
                      {revisitPercents[i]}%
                    </dt>
                    <dd className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{w.label}</span> — {w.description}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 flex items-start gap-2 text-[13px] text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                Production is measured per game played, so a pick whose season was cut short by injury is
                judged on how good the player was rather than how long he lasted.
              </p>
            </>
          ) : (
            <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              {/* Why it is missing depends on the season: the ESPN
                  explanation was shown for the current Sleeper season too,
                  where the grade is simply not due yet. */}
              <span>
                {!isComplete && view.status != null
                  ? `The hindsight grade is written once the ${view.seasonYear} season has points on the board.`
                  : isEspnEra
                    ? "Not available for this season. A hindsight grade needs per-player weekly scoring, and ESPN does not expose that for its archived seasons. Rather than fall back to final standings — which would grade the season instead of the draft — no revisited grade is issued."
                    : "Not available for this season. A hindsight grade needs per-player weekly scoring, and none is on record for it. Rather than fall back to final standings — which would grade the season instead of the draft — no revisited grade is issued."}
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {chart ? (
        <ChartFrame
          className="mt-8"
          title="Draft grade vs. reality"
          caption={`Draft-day score (across) against this week's power score (up), through Week ${chart.throughWeek}. Dashed lines mark the league averages: top-left drafted poorly and is playing well anyway, bottom-right drafted well and has little to show for it.`}
          summary={`Scatter of each team's ${view.seasonYear} draft-day score against its current power score, with dashed lines at the league averages.`}
          table={{
            headers: ["Manager", "Draft score", "Draft grade", "Power score", "Power rank"],
            rows: chart.rows.map((r) => [r.manager, r.draftScore.toFixed(1), r.grade, r.powerScore.toFixed(1), `#${r.powerRank}`]),
          }}
          height="h-80"
        >
          <LabeledScatter
            points={chart.points}
            xLabel="Draft-day score"
            yLabel="Power score"
            xFormat="fixed0"
            yFormat="fixed0"
            quadrants={{
              x: chart.points.reduce((s, p) => s + p.x, 0) / chart.points.length,
              y: chart.points.reduce((s, p) => s + p.y, 0) / chart.points.length,
            }}
            quadrantLabels={["Outran the grade", "Lived up to it", "Lived down to it", "Wasted a good draft"]}
          />
        </ChartFrame>
      ) : chartNote ? (
        <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          {chartNote}
        </p>
      ) : null}

      <section className="mt-8" aria-labelledby="revisited-heading">
        <h2 id="revisited-heading" className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
          {view.seasonYear} Drafts, Revisited
          {provisional ? (
            <span className="ml-2 align-middle text-xs font-normal tracking-normal text-muted-foreground normal-case">
              provisional · through Week {provisional.throughWeek}
            </span>
          ) : null}
        </h2>
        {rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="No revisited grades for this season"
            description={
              view.revisitAvailable
                ? "The hindsight grades have not been written yet."
                : "This season has no per-player scoring to judge the picks by."
            }
          />
        ) : (
          <div className="space-y-3">
            {rows.map(({ card, so, grade }, index) => {
              const ret = returnsByManager.get(card.managerId);
              const best = ret?.bestPicks[0];
              const worst = ret?.worstPicks[0];
              return (
                <Card key={card.managerId} className="py-0">
                  <CardContent className="space-y-3 px-4 py-4 sm:px-6">
                    <div className="flex items-center gap-3">
                      <span className="w-6 shrink-0 font-heading text-xl font-semibold tabular-nums text-muted-foreground">
                        {so ? so.rank : index + 1}
                      </span>
                      <TeamAvatar name={card.managerName} imageUrl={card.avatarUrl} className="shrink-0" />
                      <Link
                        href={`/managers/${card.managerId}`}
                        className="min-w-0 flex-1 font-heading text-lg font-semibold break-words hover:text-primary"
                      >
                        {card.managerName}
                      </Link>
                      <span className="flex shrink-0 items-center gap-1.5" aria-label="Draft-day grade, then revisited grade">
                        <span className="sr-only">Draft day</span>
                        <GradeChip grade={card.grade} title="Draft-day grade" />
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        <span className="sr-only">revisited</span>
                        <GradeChip grade={grade} size="summary" title={provisional ? `Revisited so far, through Week ${provisional.throughWeek}` : "Revisited in hindsight"} />
                      </span>
                    </div>

                    {so ? (
                      <AiText text={revisitTexts.get(card.managerId)} />
                    ) : (
                      <p className="text-sm whitespace-pre-line text-foreground/90">
                        {card.revisitedRationale ?? "No commentary yet."}
                      </p>
                    )}

                    {best || worst ? (
                      <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                        {best ? (
                          <div>
                            <dt className="inline font-semibold text-foreground">Best value: </dt>
                            <dd className="inline">
                              {best.playerName} (R{best.round}, pick {best.pickNumber}) · {signed(best.valueDelta)} slots ·{" "}
                              {best.pointsPerGame} pts/gm
                            </dd>
                          </div>
                        ) : null}
                        {worst ? (
                          <div>
                            <dt className="inline font-semibold text-foreground">Biggest miss: </dt>
                            <dd className="inline">
                              {worst.playerName} (R{worst.round}, pick {worst.pickNumber}) · {signed(worst.valueDelta)} slots ·{" "}
                              {worst.gamesPlayed > 0
                                ? `${worst.pointsPerGame} pts/gm in ${worst.gamesPlayed} game${worst.gamesPlayed === 1 ? "" : "s"}`
                                : "no points on record"}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {returns?.available ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Slots are where a player was taken minus where his points per game rank among everyone drafted:
            +20 means he produced like a pick taken twenty spots earlier. The Board tab colours every pick this
            way.
          </p>
        ) : null}
      </section>
    </>
  );
}
