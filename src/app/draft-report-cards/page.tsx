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
import { GraduationCap } from "lucide-react";

export const metadata = { title: "Draft Report Cards" };

/** Color family for a grade: A green, B primary/blue, C amber, D/F red. */
function gradeColorClasses(grade: GradeLetter | null): string {
  if (!grade) return "bg-muted text-muted-foreground";
  if (grade.startsWith("A")) return "bg-green-500/15 text-green-500";
  if (grade.startsWith("B")) return "bg-primary/15 text-primary";
  if (grade.startsWith("C")) return "bg-amber-500/15 text-amber-500";
  return "bg-destructive/15 text-destructive"; // D, F
}

function GradeBlock({
  label,
  grade,
  rationale,
}: {
  label: string;
  grade: GradeLetter | null;
  rationale: string | null;
}) {
  return (
    <div className="flex-1">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="flex items-start gap-3">
        <div
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg font-heading text-2xl font-bold tabular-nums ${gradeColorClasses(
            grade
          )}`}
        >
          {gradeLetterToDisplay(grade)}
        </div>
        <p className="flex-1 text-sm whitespace-pre-line text-muted-foreground">
          {rationale ?? "No rationale yet."}
        </p>
      </div>
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
    requestedYear && Number.isFinite(requestedYear) ? requestedYear : undefined
  );

  const isComplete = view.status === "COMPLETE";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="On the Clock"
        title="Draft Report Cards"
        description="The paper's snap grade for every draft — and the receipts once the season plays out."
      />

      {!isAIConfigured() ? (
        <p className="mt-6 rounded-md border border-dashed border-border/60 bg-card/30 px-4 py-3 text-xs text-muted-foreground">
          Rationales are placeholder text without an OPENAI_API_KEY. The letter grades
          themselves are computed deterministically from outcomes and are accurate.
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {seasons.map((s) => (
          <Link key={s.year} href={`/draft-report-cards?season=${s.year}`}>
            <Badge variant={s.year === view.seasonYear ? "default" : "outline"}>{s.year}</Badge>
          </Link>
        ))}
      </div>

      <div className="mt-8">
        {view.cards.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No draft grades for this season yet"
            description="Grades generate once a season's draft has been synced and graded."
          />
        ) : (
          <div className="space-y-4">
            {view.cards.map((card) => {
              const showRevisited = isComplete && card.revisitedGrade;
              return (
                <Card key={card.managerId}>
                  <CardContent>
                    <div className="mb-4 flex items-center gap-3">
                      <TeamAvatar name={card.managerName} imageUrl={card.avatarUrl} />
                      <Link
                        href={`/managers/${card.managerId}`}
                        className="font-heading text-lg font-semibold hover:text-primary"
                      >
                        {card.managerName}
                      </Link>
                    </div>
                    <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
                      <GradeBlock
                        label={showRevisited ? "Draft Day Grade" : "Grade"}
                        grade={card.grade}
                        rationale={card.rationale}
                      />
                      {showRevisited ? (
                        <>
                          <div className="hidden w-px shrink-0 bg-border/60 sm:block" aria-hidden />
                          <GradeBlock
                            label="Revisited"
                            grade={card.revisitedGrade}
                            rationale={card.revisitedRationale}
                          />
                        </>
                      ) : null}
                    </div>
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
