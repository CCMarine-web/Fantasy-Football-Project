import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { isAIConfigured } from "@/lib/env";
import { GradeLetter } from "@/generated/prisma/client";
import {
  getDraftReportCards,
  listGradedSeasons,
  gradeLetterToDisplay,
} from "@/server/repositories/draft-grade-repository";
import type { DraftFactor } from "@/server/stats/draft-quality";
import { GraduationCap, Info } from "lucide-react";

export const metadata = { title: "Draft Report Cards" };

/** Color family for a grade: A green, B primary/blue, C amber, D/F red. */
function gradeColorClasses(grade: GradeLetter | null): string {
  if (!grade) return "bg-muted text-muted-foreground";
  if (grade.startsWith("A")) return "bg-green-500/15 text-green-500";
  if (grade.startsWith("B")) return "bg-primary/15 text-primary";
  if (grade.startsWith("C")) return "bg-amber-500/15 text-amber-500";
  return "bg-destructive/15 text-destructive"; // D, F
}

function FactorBar({ factor }: { factor: DraftFactor }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-[13px] text-muted-foreground">
        {factor.label} <span className="text-muted-foreground/60">{Math.round(factor.weight * 100)}%</span>
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, factor.value)}%` }} />
      </div>
      <span className="w-32 shrink-0 text-right font-mono text-[13px] tabular-nums text-muted-foreground">
        {factor.raw}
      </span>
    </div>
  );
}

export default async function DraftReportCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: seasonParam } = await searchParams;
  const seasons = await listGradedSeasons();
  const requestedYear = seasonParam ? Number(seasonParam) : undefined;
  const view = await getDraftReportCards(
    requestedYear && Number.isFinite(requestedYear) ? requestedYear : undefined,
  );

  const isComplete = view.status === "COMPLETE";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="On the Clock"
        title="Draft Report Cards"
        description="A grade for every draft, judged on the decisions made in the room — not on how the season happened to end."
      />

      <div className="mt-6 flex flex-wrap gap-2">
        {seasons.map((s) => (
          <Link key={s.year} href={`/draft-report-cards?season=${s.year}`}>
            <Badge variant={s.year === view.seasonYear ? "default" : "outline"}>{s.year}</Badge>
          </Link>
        ))}
      </div>

      {/* Methodology, stated up front. */}
      {view.weights.length > 0 ? (
        <Card className="mt-6 border-border/60 bg-card/40">
          <CardContent>
            <h2 className="font-heading text-base font-semibold">How the draft-day grade is built</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Each factor is scored 0-100 against the other drafts in the same room, then blended with
              the weights below and graded on a curve. Season results, championships, waiver pickups
              and trades are deliberately <strong className="text-foreground">not</strong> inputs — a
              good draft wrecked by injuries was still a good draft, and a poor one rescued on waivers
              was still a poor one.
            </p>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {view.weights.map((w) => (
                <div key={w.key} className="flex gap-2">
                  <dt className="w-10 shrink-0 font-mono text-sm font-semibold tabular-nums text-primary">
                    {Math.round(w.weight * 100)}%
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
                Average draft position is not on record for this season, so the value-vs-ADP factor is
                excluded and its weight is spread across the others. Everything shown is measured from
                the draft board itself.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!isAIConfigured() ? (
        <p className="mt-6 rounded-md border border-dashed border-border/60 bg-card/30 px-4 py-3 text-xs text-muted-foreground">
          Written commentary is placeholder text without an OPENAI_API_KEY. The letter grades and
          factor scores are computed deterministically and are accurate regardless.
        </p>
      ) : null}

      <div className="mt-8">
        {view.cards.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No draft grades for this season yet"
            description="Grades generate once a season's draft has been synced and graded."
          />
        ) : (
          <div className="space-y-4">
            {view.cards.map((card, index) => {
              const showRevisited = isComplete && card.revisitedGrade;
              return (
                <Card key={card.managerId}>
                  <CardContent>
                    <div className="mb-4 flex items-center gap-3">
                      <span className="font-heading text-xl font-semibold tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <TeamAvatar name={card.managerName} imageUrl={card.avatarUrl} className="shrink-0" />
                      <Link
                        href={`/managers/${card.managerId}`}
                        className="min-w-0 truncate font-heading text-lg font-semibold hover:text-primary"
                      >
                        {card.managerName}
                      </Link>
                    </div>

                    {/* Original grade — the headline, always shown. */}
                    <div className="flex flex-col gap-4 lg:flex-row">
                      <div className="min-w-0 flex-1">
                        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          Original draft grade
                          <span className="ml-1 font-normal normal-case">— judged on draft day only</span>
                        </p>
                        <div className="flex items-start gap-3">
                          <div
                            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg font-heading text-2xl font-bold tabular-nums ${gradeColorClasses(card.grade)}`}
                          >
                            {gradeLetterToDisplay(card.grade)}
                          </div>
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
                            {card.factors.map((f) => (
                              <FactorBar key={f.key} factor={f} />
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* Revisited grade — visually separated and explicitly hindsight. */}
                    {showRevisited ? (
                      <div className="mt-5 rounded-lg border border-dashed border-border/60 bg-muted/20 p-4">
                        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                          Revisited in hindsight
                          <span className="ml-1 font-normal normal-case">
                            — how it actually played out. Does not replace the grade above.
                          </span>
                        </p>
                        <div className="flex items-start gap-3">
                          <div
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg font-heading text-lg font-bold tabular-nums ${gradeColorClasses(card.revisitedGrade)}`}
                          >
                            {gradeLetterToDisplay(card.revisitedGrade)}
                          </div>
                          <p className="flex-1 text-sm whitespace-pre-line text-muted-foreground">
                            {card.revisitedRationale ?? "No commentary yet."}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
