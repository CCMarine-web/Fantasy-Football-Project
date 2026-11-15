import { renderAtRequestIfNoDatabase } from "@/server/build-guard";
import { permanentRedirect } from "next/navigation";

/**
 * The draft board moved to the Board tab of /draft-report-cards. next.config.ts
 * redirects /drafts before it ever reaches this route; this page is the
 * fallback so an old link can never 404, and it keeps the season.
 */
export default async function DraftsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  await renderAtRequestIfNoDatabase();
  const { season } = await searchParams;
  const params = new URLSearchParams({ tab: "board" });
  if (season && /^\d{4}$/.test(season)) params.set("season", season);
  permanentRedirect(`/draft-report-cards?${params.toString()}`);
}
