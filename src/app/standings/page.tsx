import { StandingsPageView } from "@/components/standings/standings-page";
import { getCurrentSeason } from "@/server/repositories/season-repository";

export const metadata = { title: "Standings" };

/**
 * Pre-rendered (ISR). The data changes when the pipeline runs, and the pipeline
 * revalidates every page when it does; the hour is only a safety net.
 */
export const revalidate = 3600;

export default async function StandingsPage() {
  return <StandingsPageView season={await getCurrentSeason()} />;
}
