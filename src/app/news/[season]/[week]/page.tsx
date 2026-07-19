import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getArticleBySeasonWeek } from "@/server/repositories/news-repository";
import type { ArticleSectionType } from "@/generated/prisma/client";

export const metadata = { title: "Weekly Issue" };

const SECTION_LABELS: Record<ArticleSectionType, string> = {
  INTRO: "This Week in the League",
  MATCHUP_RECAP: "Matchup Recap",
  POWER_RANKINGS: "Power Rankings",
  MANAGER_OF_WEEK: "Manager of the Week",
  WORST_DECISION: "Worst Decision of the Week",
  BAD_BEAT: "Bad Beat",
  FRAUD_WIN: "Fraud Win",
  QUOTE_OF_WEEK: "Quote of the Week",
  WAIVER_REPORT: "Waiver Report",
  PREVIEW: "Next Week",
  GENERIC: "",
};

export default async function WeeklyIssuePage({
  params,
}: {
  params: Promise<{ season: string; week: string }>;
}) {
  const { season, week } = await params;
  const article = await getArticleBySeasonWeek(Number(season), Number(week));
  if (!article) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
        {article.season.year} · Week {article.week}
      </p>
      <h1 className="mt-2 font-heading text-4xl font-semibold tracking-wide uppercase">
        {article.title}
      </h1>

      <div className="mt-8 space-y-8">
        {article.sections.map((section) => (
          <section key={section.id}>
            <h2 className="mb-2 font-heading text-lg font-semibold tracking-wide uppercase text-primary">
              {section.heading || SECTION_LABELS[section.sectionType]}
              {section.relatedManager ? (
                <Badge variant="outline" className="ml-2 align-middle text-[10px] normal-case">
                  {section.relatedManager.displayName}
                </Badge>
              ) : null}
            </h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
              {section.body}
            </p>
            <Separator className="mt-6" />
          </section>
        ))}
      </div>
    </div>
  );
}
