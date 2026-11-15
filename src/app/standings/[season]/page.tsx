import type { Metadata } from "next";
import { renderAtRequestIfNoDatabase, staticParamsOrEmpty } from "@/server/build-guard";
import { notFound, redirect } from "next/navigation";
import { StandingsPageView } from "@/components/standings/standings-page";
import { getSeasonByYear, listSeasons } from "@/server/repositories/season-repository";

export const revalidate = 3600;

/** Every season with games, pre-rendered at build. */
export async function generateStaticParams() {
  return staticParamsOrEmpty(async () => (await listSeasons()).filter((s) => s.status !== "UPCOMING").map((s) => ({ season: String(s.year) })));
}

export async function generateMetadata({ params }: { params: Promise<{ season: string }> }): Promise<Metadata> {
  const { season } = await params;
  return { title: `${season} Standings` };
}

export default async function SeasonStandingsPage({ params }: { params: Promise<{ season: string }> }) {
  // Pre-rendered when the build can reach the database; otherwise rendered per request.
  await renderAtRequestIfNoDatabase();
  const { season } = await params;
  const s = await getSeasonByYear(Number(season));
  if (!s) notFound();
  if (s.isCurrent) redirect("/standings");
  return <StandingsPageView season={s} />;
}
