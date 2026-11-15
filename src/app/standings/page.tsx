import { StandingsPageView } from "@/components/standings/standings-page";
import { pageMetadata } from "@/lib/indexing";
import { renderAtRequestIfNoDatabase } from "@/server/build-guard";
import { getCurrentSeason } from "@/server/repositories/season-repository";

export const metadata = pageMetadata("/standings", {
  title: "Standings",
  description:
    "Current Rat Trap Fantasy Football League standings: records, points for and against, luck in wins and playoff odds from 10,000 simulated seasons.",
});

/**
 * Pre-rendered (ISR). The data changes when the pipeline runs, and the pipeline
 * revalidates every page when it does; the hour is only a safety net.
 */
export const revalidate = 3600;

export default async function StandingsPage() {
  // Pre-rendered when the build can reach the database; otherwise rendered per request.
  await renderAtRequestIfNoDatabase();
  return <StandingsPageView season={await getCurrentSeason()} />;
}
