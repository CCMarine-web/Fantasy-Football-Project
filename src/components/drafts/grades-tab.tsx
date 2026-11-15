import Link from "next/link";
import { managerPath } from "@/lib/slug";
import { AiText } from "@/components/shared/ai-text";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { gradeLetterToDisplay, type DraftReportCardsView } from "@/server/repositories/draft-grade-repository";
import type { RenderedText } from "@/server/text/read";
import { strongestFactor } from "@/server/stats/draft-quality";
import {
  ADP_REASON,
  CONFIDENCE_LABEL,
  FactorBar,
  GradeChip,
  asSentence,
  weightPercents,
} from "@/components/drafts/grade-ui";
import { draftsHref } from "@/components/drafts/draft-tabs";
import { ChevronDown, GraduationCap, Info } from "lucide-react";

/**
 * The Grades tab: the draft-day report cards — methodology, the season's
 * ranking, then a card per team. The hindsight grade has its own tab
 * (Revisited); the ranking and the cards still show it alongside, labelled.
 */
export function GradesTab({
  view,
  revisitTexts,
}: {
  view: DraftReportCardsView;
  revisitTexts: Map<string, RenderedText>;
}) {
  const isComplete = view.status === "COMPLETE";
  const originalPercents = weightPercents(view.weights);
  // When ADP is missing it already has its own line above the confidence note,
  // so the note leaves it out rather than saying it twice.
  const seasonReasons = view.adpAvailable
    ? view.confidenceReasons
    : view.confidenceReasons.filter((r) => !ADP_REASON.test(r));

  return (
    <>

      {/*
       * The whole season at a glance, before any of the long-form cards. The
       * page previously opened with ten stacked report cards, so answering
       * "who drafted best" meant scrolling past nine of them.
       */}
      {view.cards.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
            {view.seasonYear} Draft Rankings
          </h2>
          <div className="relative overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-2 py-2 text-left sm:px-4">#</th>
                  <th className="px-2 py-2 text-left sm:px-4">Manager</th>
                  <th className="px-2 py-2 text-center sm:px-4">Grade</th>
                  <th className="px-2 py-2 text-right sm:px-4">Score</th>
                  {(isComplete && view.revisitAvailable) || view.provisionalRevisit ? (
                    <th className="hidden px-2 py-2 text-center sm:table-cell sm:px-4">
                      {view.provisionalRevisit ? `Revisited · thru Wk ${view.provisionalRevisit.throughWeek}` : "Revisited"}
                    </th>
                  ) : null}
                  <th className="hidden px-2 py-2 text-left sm:px-4 md:table-cell">Strongest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {view.cards.map((card, index) => {
                  // Never a dropped factor, nor one that scored the team by default.
                  const best = strongestFactor(card.factors);
                  const so = view.provisionalRevisit?.grades[card.managerId];
                  return (
                    <tr key={card.managerId}>
                      <td className="px-2 py-2 font-mono tabular-nums text-muted-foreground sm:px-4">
                        {index + 1}
                      </td>
                      <td className="px-2 py-2 sm:px-4">
                        <Link href={managerPath(card.managerName)} className="font-medium hover:text-primary">
                          {card.managerName}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-center sm:px-4">
                        <GradeChip grade={card.grade} />
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground sm:px-4">
                        {card.score != null ? card.score.toFixed(1) : "—"}
                      </td>
                      {view.provisionalRevisit ? (
                        <td className="hidden px-2 py-2 text-center sm:table-cell sm:px-4">
                          {so ? (
                            <GradeChip
                              grade={so.grade}
                              title={`Provisional: draft returns rank ${so.rank} of ${Object.keys(view.provisionalRevisit.grades).length} through Week ${view.provisionalRevisit.throughWeek}`}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                      ) : isComplete && view.revisitAvailable ? (
                        <td className="hidden px-2 py-2 text-center sm:table-cell sm:px-4">
                          <span className="font-heading text-sm font-semibold text-muted-foreground">
                            {gradeLetterToDisplay(card.revisitedGrade)}
                          </span>
                        </td>
                      ) : null}
                      <td className="hidden px-2 py-2 text-xs text-muted-foreground sm:px-4 md:table-cell">
                        {best ? best.label : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Full report cards below — open one to see its factor breakdown and commentary.
          </p>
        </section>
      ) : null}

      <div className="mt-8">
        {view.cards.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No draft grades for this season yet"
            description="Grades generate once a season's draft has been synced and graded."
          />
        ) : (
          <div className="space-y-3">
            {view.cards.map((card, index) => {
              const provisional = view.provisionalRevisit?.grades[card.managerId];
              const revisitedGrade = provisional?.grade ?? (isComplete ? card.revisitedGrade : null);
              const percents = weightPercents(card.factors);
              return (
                <Card key={card.managerId} className="py-0">
                  <CardContent className="p-0">
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-6 py-4 hover:bg-muted/30">
                        <span className="font-heading text-xl font-semibold tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                        <TeamAvatar name={card.managerName} imageUrl={card.avatarUrl} className="shrink-0" />
                        {/* Wraps rather than truncates: "Michael Barkeme…" is
                            not a name anyone in the league goes by. */}
                        <span className="min-w-0 flex-1 font-heading text-lg font-semibold break-words">
                          {card.managerName}
                        </span>
                        <GradeChip grade={card.grade} size="summary" />
                        <ChevronDown
                          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                          aria-hidden
                        />
                        <span className="sr-only">Show full report card</span>
                      </summary>

                      <div className="border-t border-border/50 px-6 py-4">
                        <div className="mb-4 flex flex-wrap items-center gap-3">
                          <Link
                            href={managerPath(card.managerName)}
                            className="min-w-0 text-sm font-medium break-words hover:text-primary"
                          >
                            View {card.managerName}&rsquo;s profile
                          </Link>
                          {/* How much the data behind this particular grade
                              supports it — a letter reads as equally authoritative
                              whether it rests on sixteen resolved picks or nine. */}
                          <Badge
                            variant="outline"
                            className={`ml-auto shrink-0 ${card.confidence === "HIGH" ? "text-field" : card.confidence === "LOW" ? "text-destructive" : "text-muted-foreground"}`}
                            title={
                              card.confidenceReasons.length > 0
                                ? card.confidenceReasons.join("; ")
                                : `All ${card.pickCount} picks resolved with prior-season production on record.`
                            }
                          >
                            {CONFIDENCE_LABEL[card.confidence]}
                          </Badge>
                        </div>

                        {card.confidenceReasons.length > 0 ? (
                          <p className="mb-3 text-xs text-muted-foreground">{asSentence(card.confidenceReasons)}</p>
                        ) : null}

                        {/* Original grade — the headline, always shown. */}
                        <div className="flex flex-col gap-4 lg:flex-row">
                          <div className="min-w-0 flex-1">
                            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                              Original draft grade
                              <span className="ml-1 font-normal normal-case">— judged on draft day only</span>
                            </p>
                            <div className="flex items-start gap-3">
                              <GradeChip grade={card.grade} size="lg" />
                              <div className="min-w-0 flex-1">
                                {card.score != null ? (
                                  <p className="mb-1 font-mono text-xs text-muted-foreground">
                                    Draft score {card.score.toFixed(1)}/100
                                  </p>
                                ) : null}
                                <p className="text-sm whitespace-pre-line text-foreground/90">
                                  {card.rationale ?? "No commentary yet."}
                                </p>
                              </div>
                            </div>
                          </div>

                          {card.factors.length > 0 ? (
                            <div className="shrink-0 lg:w-96">
                              <div className="space-y-1">
                                {card.factors.map((f, i) => (
                                  <FactorBar key={f.key} factor={f} percent={percents[i]} />
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {/* Revisited grade — visually separated and explicitly hindsight. */}
                        {revisitedGrade ? (
                          <div className="mt-5 rounded-lg border border-dashed border-border/60 bg-muted/20 p-4">
                            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                              {provisional
                                ? `Revisited so far · through Week ${view.provisionalRevisit?.throughWeek}`
                                : "Revisited in hindsight"}
                              <span className="ml-1 font-normal normal-case">
                                — what the picks actually produced. Does not replace the grade above.
                              </span>
                            </p>
                            <div className="flex items-start gap-3">
                              <GradeChip grade={revisitedGrade} size="md" />
                              {provisional ? (
                                <AiText text={revisitTexts.get(card.managerId)} className="flex-1" />
                              ) : (
                                <p className="flex-1 text-sm whitespace-pre-line text-muted-foreground">
                                  {card.revisitedRationale ?? "No commentary yet."}
                                </p>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      {/* Methodology: collapsed at the bottom ("How it's calculated"). */}
      {view.weights.length > 0 ? (
        <details className="mt-8 rounded-xl border border-border bg-card/40 p-4">
          <summary className="flex min-h-11 cursor-pointer items-center font-heading text-base font-semibold">How it&rsquo;s calculated: the draft-day grade</summary>
          <div>
            <p className="mt-1 text-sm text-muted-foreground">
              Each factor is scored 0-100 against the other drafts in the same room, then blended with
              the weights below and graded on a curve. Season results, championships, waiver pickups
              and trades are deliberately <strong className="text-foreground">not</strong> inputs — a
              good draft wrecked by injuries was still a good draft, and a poor one rescued on waivers
              was still a poor one.
            </p>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {view.weights.map((w, i) => (
                <div key={w.key} className="flex gap-2">
                  <dt className="w-10 shrink-0 font-mono text-sm font-semibold tabular-nums text-primary">
                    {originalPercents[i]}%
                  </dt>
                  <dd className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{w.label}</span> — {w.description}
                  </dd>
                </div>
              ))}
            </dl>
            {!view.adpAvailable ? (
              <p className="mt-3 flex items-start gap-2 text-[13px] text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span>
                  There is no free, reliable source of average draft position for this league&rsquo;s
                  format, so no ADP is on record for any season and the value-vs-ADP factor is left out.
                  Its weight is spread across the factors above, and everything shown is measured from
                  the draft board itself.
                </span>
              </p>
            ) : null}

            {/*
             * What the recorded data does and does not support. A letter grade
             * carries the same authority however thin the evidence behind it,
             * so the evidence is stated next to it.
             */}
            {view.confidenceReasons.length > 0 ? (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[13px] text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span>
                  <strong className="text-foreground">
                    {CONFIDENCE_LABEL[view.confidence]} for {view.seasonYear}.
                  </strong>{" "}
                  {seasonReasons.length > 0
                    ? asSentence(seasonReasons)
                    : "The missing average draft position, noted above, is the only gap."}{" "}
                  Every team&rsquo;s own confidence is shown on its card.
                </span>
              </div>
            ) : null}

            {/* The second, separate grade lives on its own tab. */}
            <p className="mt-4 border-t border-border/40 pt-3 text-sm text-muted-foreground">
              The hindsight grade — what the drafted players actually produced — is a separate verdict
              that never replaces this one.{" "}
              <Link href={draftsHref("revisited", view.seasonYear)} className="text-primary hover:underline">
                See how it is built on the Revisited tab →
              </Link>
            </p>
          </div>
        </details>
      ) : null}
    </>
  );
}
