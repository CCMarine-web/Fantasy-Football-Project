import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StandingsTable } from "@/components/standings/standings-table";
import { getCurrentSeason } from "@/server/repositories/season-repository";
import { getStandingsView } from "@/server/repositories/standings-repository";
import { MatchupsHubLink } from "@/components/shared/matchups-hub-link";
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

  const view = await getStandingsView(season.id);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={`${season.year} Season`}
        title="Standings"
        description={
          view.hasPlayedGames
            ? "Points for/against, all-play record, expected wins, and schedule luck — updated after every sync."
            : "No game has been played this season, so there is nothing to rank yet. The teams are listed in a stated order until there is."
        }
      />
      <MatchupsHubLink what="standings" />

      {/*
        Before week 1 the table used to number ten 0-0 teams 1 to 10 from
        whatever order the database returned, which told every reader where they
        stood in a season nobody had played. The order is now named, and the
        position column shows a dash until there is a position to show.
      */}
      {!view.hasPlayedGames ? (
        <p className="mt-4 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <strong className="text-foreground">These are not rankings.</strong> {view.orderingLabel}.
          Actual standings appear as soon as the first week is final.
        </p>
      ) : null}

      <div className="mt-8">
        {view.rows.length > 0 ? (
          <StandingsTable rows={view.rows} caption={view.orderingLabel} />
        ) : (
          <EmptyState
            icon={BarChart3}
            title="No teams on record yet"
            description="Standings will populate once the season's rosters are synced."
          />
        )}
      </div>
    </div>
  );
}
