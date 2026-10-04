import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listCurrentWeeklyIssues, listPublishedArticles } from "@/server/repositories/news-repository";
import { MatchupsHubLink } from "@/components/shared/matchups-hub-link";
import { Newspaper } from "lucide-react";
import { BRAND } from "@/lib/branding";

export const metadata = { title: "News" };

/** Readable names for the article types, rather than the database enum. */
const ARTICLE_LABEL: Record<string, string> = {
  WEEKLY_ISSUE: "Weekly issue",
  MATCHUP_PREVIEW: "Matchup preview",
  MATCHUP_RECAP: "Matchup recap",
  SEASON_SUMMARY: "Season retrospective",
  MANAGER_PROFILE: "Manager profile",
  TRADE_RETROSPECTIVE: "Trade retrospective",
};

export default async function NewsPage() {
  const [articles, issues] = await Promise.all([listPublishedArticles(), listCurrentWeeklyIssues()]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader freshness
        eyebrow={BRAND.name}
        title="News Archive"
        description="The weekly league newspaper — recaps, power rankings, awards, and everything in between."
      />
      <MatchupsHubLink what="news" />
      {issues.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
            {issues[0].year} weekly issues
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {issues.map((issue) => (
              <Link key={issue.week} href={`/news/${issue.year}/${issue.week}`} className="block">
                <Card className="transition-colors hover:border-primary/60">
                  <CardContent className="flex items-center justify-between gap-3">
                    <span className="font-heading text-lg font-semibold uppercase">Week {issue.week}</span>
                    <span className="text-xs font-medium text-primary">Results, recaps &amp; awards →</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <div className="mt-8 space-y-4">
        {articles.length === 0 ? (
          <EmptyState icon={Newspaper} title="No issues published yet" />
        ) : (
          articles.map((article) => {
            /*
             * Every card links somewhere real. A season retrospective has no
             * week, and the old code sent those to "#" — which is every
             * published article on this site, so the entire archive was a page
             * of links that went nowhere. They belong on the season page.
             */
            const href = article.week
              ? `/news/${article.season.year}/${article.week}`
              : `/history/${article.season.year}`;
            return (
              <Link key={article.id} href={href} className="block">
                <Card className="transition-colors hover:border-primary/60">
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[12px]">
                        {ARTICLE_LABEL[article.type] ?? "Article"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {article.season.year}
                        {article.week ? ` · Week ${article.week}` : ""}
                      </span>
                    </div>
                    <p className="mt-2 font-heading text-xl font-semibold">{article.title}</p>
                    <span className="mt-1 inline-block text-xs font-medium text-primary">
                      {article.week
                        ? `Read week ${article.week} →`
                        : `Read the ${article.season.year} season →`}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
