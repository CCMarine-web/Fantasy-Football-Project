import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { MatchupCard } from "@/components/shared/matchup-card";
import { getCurrentSeason } from "@/server/repositories/season-repository";
import { getMatchupsForWeek } from "@/server/repositories/matchup-repository";
import { prisma } from "@/lib/db";
import { Swords } from "lucide-react";

export const metadata = { title: "Matchups" };

export default async function MatchupsPage() {
  const season = await getCurrentSeason();

  if (!season) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader eyebrow="League" title="Matchups" />
        <div className="mt-8">
          <EmptyState icon={Swords} title="No active season yet" />
        </div>
      </div>
    );
  }

  const weeksWithMatchups = await prisma.matchup.findMany({
    where: { seasonId: season.id },
    distinct: ["week"],
    select: { week: true },
    orderBy: { week: "desc" },
  });

  const weeksData = await Promise.all(
    weeksWithMatchups.map(async (w) => ({
      week: w.week,
      matchups: await getMatchupsForWeek(season.id, w.week, season.year),
    })),
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={`${season.year} Season`}
        title="Matchups"
        description="Every matchup this season — projections before kickoff, final scores after."
      />
      <div className="mt-8 space-y-10">
        {weeksData.length === 0 ? (
          <EmptyState icon={Swords} title="No matchups scheduled yet" />
        ) : (
          weeksData.map(({ week, matchups }) => (
            <section key={week}>
              <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
                Week {week}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {matchups.map((m) => (
                  <MatchupCard key={m.matchupId} data={m} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
