import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StandingsTable } from "@/components/standings/standings-table";
import { getCurrentSeason } from "@/server/repositories/season-repository";
import { getStandingsForSeason } from "@/server/repositories/standings-repository";
import { BarChart3 } from "lucide-react";

export const metadata = { title: "Standings" };

export default async function StandingsPage() {
  const season = await getCurrentSeason();

  if (!season) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader eyebrow="League" title="Standings" />
        <div className="mt-8">
          <EmptyState
            icon={BarChart3}
            title="No active season yet"
            description="Once a season is created and synced, standings will appear here."
          />
        </div>
      </div>
    );
  }

  const rows = await getStandingsForSeason(season.id);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={`${season.year} Season`}
        title="Standings"
        description="Points for/against, all-play record, expected wins, and schedule luck — updated after every sync."
      />
      <div className="mt-8">
        {rows.length > 0 ? (
          <StandingsTable rows={rows} />
        ) : (
          <EmptyState
            icon={BarChart3}
            title="No games played yet"
            description="Standings will populate once the season's first matchups are final."
          />
        )}
      </div>
    </div>
  );
}
