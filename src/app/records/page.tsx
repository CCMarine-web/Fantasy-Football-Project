import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentLeagueRecords } from "@/server/repositories/records-repository";
import type { RecordCategory } from "@/generated/prisma/client";
import { Award } from "lucide-react";

export const metadata = { title: "Records" };

const CATEGORY_LABELS: Record<RecordCategory, string> = {
  HIGHEST_WEEKLY_SCORE: "Highest Weekly Score",
  LOWEST_WEEKLY_SCORE: "Lowest Weekly Score",
  LARGEST_BLOWOUT: "Largest Blowout",
  CLOSEST_GAME: "Closest Game",
  HIGHEST_SCORE_IN_LOSS: "Highest Score in a Loss",
  LOWEST_SCORE_IN_WIN: "Lowest Score in a Win",
  MOST_BENCH_POINTS: "Most Bench Points",
  MOST_CHAMPIONSHIPS: "Most Championships",
  MOST_PLAYOFF_APPEARANCES: "Most Playoff Appearances",
  LONGEST_WIN_STREAK: "Longest Winning Streak",
  LONGEST_LOSS_STREAK: "Longest Losing Streak",
  MOST_POINTS_SEASON: "Most Points in a Season",
  BEST_LINEUP_EFFICIENCY: "Best Lineup Efficiency",
  WORST_LINEUP_EFFICIENCY: "Worst Lineup Efficiency",
};

const CATEGORY_ORDER: RecordCategory[] = [
  "HIGHEST_WEEKLY_SCORE",
  "LOWEST_WEEKLY_SCORE",
  "LARGEST_BLOWOUT",
  "CLOSEST_GAME",
  "HIGHEST_SCORE_IN_LOSS",
  "LOWEST_SCORE_IN_WIN",
  "MOST_BENCH_POINTS",
  "MOST_POINTS_SEASON",
  "BEST_LINEUP_EFFICIENCY",
  "WORST_LINEUP_EFFICIENCY",
  "MOST_CHAMPIONSHIPS",
  "MOST_PLAYOFF_APPEARANCES",
  "LONGEST_WIN_STREAK",
  "LONGEST_LOSS_STREAK",
];

export default async function RecordsPage() {
  const records = await getCurrentLeagueRecords();
  const hasAny = CATEGORY_ORDER.some((c) => (records.get(c)?.length ?? 0) > 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The Ledger"
        title="League Records"
        description="Every record on the books — updated automatically as new games are played."
      />
      <div className="mt-8">
        {!hasAny ? (
          <EmptyState icon={Award} title="No records set yet" />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {CATEGORY_ORDER.map((category) => {
              const holders = records.get(category) ?? [];
              const top = holders[0];
              return (
                <Card key={category}>
                  <CardHeader>
                    <CardTitle className="text-sm tracking-wide uppercase">
                      {CATEGORY_LABELS[category]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {top ? (
                      <div>
                        <p className="font-heading text-3xl font-semibold tabular-nums">
                          {top.value.toFixed(top.value % 1 === 0 ? 0 : 1)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {top.manager ? (
                            <Link href={`/managers/${top.manager.id}`} className="hover:text-primary">
                              {top.manager.displayName}
                            </Link>
                          ) : (
                            "—"
                          )}
                          {top.season ? ` · ${top.season.year}` : ""}
                          {top.week ? `, Week ${top.week}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{top.description}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No record set yet.</p>
                    )}
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
